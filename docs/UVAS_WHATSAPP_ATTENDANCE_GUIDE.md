# Portal Uvas Reports via WhatsApp

## Goal

Implement two WhatsApp report flows for Portal Uvas, both fully non-AI and wizard-based:

1. Celula attendance report
2. Celula service attendance report

Required behavior:
- User can choose report type directly.
- If report was not filled, send reminders on D+1 and D+3.
- For celula attendance report:
  - resolve celulas where user is leader across all churches
  - if only one celula, auto-select
  - if many, show list and ask selection
  - ask members attendance by numbers or names
  - ask visitors quantity
  - ask offer amount
  - if offer > 0, ask if sent and how sent
  - show summary and confirm before create
- There must be an option to edit an existing report.

---

## Current State of Placeholders

The following files already exist as stubs and must be implemented:

- `src/modules/whatsapp/actions/uvas/register-attendance.action.ts`
  - Class: `UvasRegisterAttendanceAction`
  - Currently throws `NOT_IMPLEMENTED`
  - Must be refactored to implement the `ActionHandler` interface (see below)

- `src/modules/whatsapp/actions/uvas/fill-report-reminder.action.ts`
  - Class: `UvasFillReportReminderAction`
  - Currently throws `NOT_IMPLEMENTED`
  - Must be wired into the BullMQ scheduler for reminder dispatch

- `src/modules/whatsapp/integrations/adapters/uvas-project.adapter.ts`
  - Class: `UvasProjectAdapter extends BaseHttpProjectAdapter`
  - `adapterKey = 'uvas'`
  - Must add methods for fetching celulas and members from the Uvas API
  - Already registered in `WhatsappModule`

- `src/modules/whatsapp/actions/uvas/uvas-action.types.ts`
  - Types `FillReportReminderPayload` and `RegisterAttendancePayload` already declared
  - Extend these with the full wizard payload fields

All uvas actions are already exported from `src/modules/whatsapp/actions/uvas/index.ts` and provided in `WhatsappModule`.

---

## Architecture Reference

### ActionHandler interface

All wizard entry handlers must implement:

```ts
// src/modules/whatsapp/actions/action.types.ts
interface ActionHandler {
    readonly actionKey: string;
    canHandle(context: ActionContext): boolean;
    handle(context: ActionContext): Promise<ActionResult>;
}

type ActionContext = {
    dbContact: any;
    contactPayload: any;
    conversation: any;
    message: any;
    messageText: string;
    session: any; // ConversationSession row including contextJson
};
```

### Session model

State is persisted in `ConversationSession` (table `conversation_sessions`):

```
ConversationSession
- id
- contactId         (unique)
- activeProjectId
- availableProjectIds (json)
- state             (ConversationSessionState enum)
- currentActionKey  (string | null)
- contextJson       (json | null)  <-- wizard step and accumulated data go here
- expiresAt
- updatedAt
```

Existing `ConversationSessionState` enum values:
- `IDLE`
- `AWAITING_PROJECT_SELECTION`
- `AWAITING_ACTION_SELECTION`
- `AWAITING_ACTION_INPUT`  <-- use this for all wizard steps
- `AWAITING_CONFIRMATION`
- `PROCESSING_ASYNC`

Wizard sub-states (stored as `step` inside `contextJson`, not as new enum values):
- `AWAITING_REPORT_TYPE`
- `AWAITING_CELULA_SELECTION`
- `AWAITING_MEETING_DATE`
- `AWAITING_MEMBER_SELECTION`
- `AWAITING_MEMBER_CONFIRMATION`
- `AWAITING_VISITORS_COUNT`
- `AWAITING_OFFER_AMOUNT`
- `AWAITING_OFFER_SENT_CONFIRMATION`
- `AWAITING_OFFER_TRANSFER_METHOD`
- `AWAITING_FINAL_CONFIRMATION`
- `AWAITING_SERVICE_DATE`
- `AWAITING_SERVICE_MEMBER_SELECTION`
- `AWAITING_SERVICE_CONFIRMATION`
- `AWAITING_EDIT_REPORT_TYPE`
- `AWAITING_EDIT_REPORT_SELECTION`
- `AWAITING_EDIT_FIELD_SELECTION`

### Session update helpers

Use `ConversationSessionService` (already injectable) to update session state:

```ts
// Set session to wizard in-progress
await prisma.conversationSession.update({
    where: { contactId },
    data: {
        state: ConversationSessionState.AWAITING_ACTION_INPUT,
        currentActionKey: 'uvas.fill_celula_attendance',
        contextJson: { step: 'AWAITING_MEETING_DATE', celulaId: '...', ... },
    }
});

// Reset session when wizard completes or is cancelled
await sessionService.clearActiveProject(contactId); // resets to IDLE
```

### Sending messages

Use `OutboundMessengerService` to send and `MessagePersistenceService` to persist:

```ts
const sent = await this.outboundMessenger.sendTextMessage(waId, text);
await this.messagePersistence.saveOutboundMessage(conversationId, contactId, text, sent?.messages?.[0]?.id);
```

### ActionRouterService registration

New action handlers must be:
1. Added as providers in `WhatsappModule` (`src/modules/whatsapp/whatsapp.module.ts`)
2. Injected in `ActionRouterService` constructor and added to `this.handlers` array

```ts
// src/modules/whatsapp/actions/action-router.service.ts
this.handlers = [
    pendingProjectSelectionAction,
    switchProjectAction,
    menuAction,
    helpAction,
    // add new uvas wizard entry handler here
];
```

### UvasProjectAdapter

Extend `UvasProjectAdapter` with methods that call the Uvas API via the project's `apiUrl` and `apiKey`:

```ts
// src/modules/whatsapp/integrations/adapters/uvas-project.adapter.ts
async getCelulasByLeader(project: any, waId: string): Promise<Celula[]>
async getMembersByCelula(project: any, celulaId: string): Promise<Member[]>
async postAttendanceReport(project: any, celulaId: string, payload: any): Promise<any>
async postServiceAttendanceReport(project: any, celulaId: string, payload: any): Promise<any>
async patchReport(project: any, reportId: string, payload: any): Promise<any>
```

---

## Part A: Report Types and Entry Commands

### A1) New wizard entry handler

Create `src/modules/whatsapp/actions/uvas/fill-celula-report.action.ts`.

This single handler responds to the entry commands and dispatches all subsequent wizard steps. It holds the entire state machine.

Action keys:
- `uvas.fill_celula_attendance`
- `uvas.fill_celula_service_attendance`
- `uvas.edit_report`

Entry trigger — `canHandle()` returns true when:
- Session state is `AWAITING_ACTION_INPUT` and `currentActionKey` starts with `uvas.fill_celula` or `uvas.edit_report`
- OR message text matches one of:
  - `preencher relatorio`
  - `relatorio celula`
  - `relatorio culto celula`
  - `editar relatorio`
  - AND active project is Uvas (check via `UvasProjectAdapter.supportsProject`)

Refactor `UvasRegisterAttendanceAction` (existing stub) into this new handler, or keep the old file as a thin delegation layer.

### A2) Initial menu message

When entry commands are matched and session has no active wizard step, send:

```
Escolha o tipo de relatorio:
1) Relatorio de presenca da celula
2) Relatorio de presenca no culto da celula
3) Editar relatorio existente
```

Set session:
- `state = AWAITING_ACTION_INPUT`
- `currentActionKey = 'uvas.fill_celula_attendance'`
- `contextJson = { step: 'AWAITING_REPORT_TYPE' }`

---

## Part B: Reminder Flow (D+1 and D+3)

### B1) Reminder policy

For each expected weekly report per leader/celula:
1. If not submitted by next day (D+1), send reminder.
2. If still not submitted by D+3, send second reminder.
3. Stop reminders once report is submitted.

### B2) Reminder scheduler via BullMQ

The project already uses BullMQ (see `src/modules/queue/`).

Implementation steps:
1. Create a new BullMQ queue `uvas-reminders` in `QueueModule`.
2. Create a recurring job (cron via BullMQ repeatable) that runs daily.
3. Job processor queries `UvasExpectedWeeklyReport` records with `submittedAt = null`.
4. For each pending record, compute days since `weekKey` date.
5. Send reminder via `UvasFillReportReminderAction.execute()` (existing stub, must be implemented).
6. Update `reminderD1SentAt` / `reminderD3SentAt` to avoid duplicate sends.

### B3) Prisma model: UvasExpectedWeeklyReport

Add to `prisma/schema.prisma`:

```prisma
model UvasExpectedWeeklyReport {
  id                String    @id @default(cuid())
  weekKey           String    // ISO date of Monday of that week (e.g. 2026-05-11)
  celulaId          String    @map("celula_id")
  celulaName        String    @map("celula_name")
  leaderContactId   String    @map("leader_contact_id")
  leaderContact     Contact   @relation(fields: [leaderContactId], references: [id])
  reportType        String    @map("report_type") // "celula" | "culto"
  submittedAt       DateTime? @map("submitted_at")
  reminderD1SentAt  DateTime? @map("reminder_d1_sent_at")
  reminderD3SentAt  DateTime? @map("reminder_d3_sent_at")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@unique([weekKey, celulaId, reportType])
  @@map("uvas_expected_weekly_reports")
}
```

### B4) Reminder message

Implement in `UvasFillReportReminderAction`:

```
Voce ainda nao preencheu o relatorio da semana da celula <nome>.
Responda:
1 para preencher relatorio de celula
2 para preencher relatorio de culto
3 para editar um relatorio
```

---

## Part C: Full Wizard - Celula Attendance Report

### C1) contextJson shape during wizard

```ts
type AttendanceWizardContext = {
    step: string;
    reportType?: 'celula' | 'culto';
    celulas?: Array<{ id: string; name: string }>;
    celulaId?: string;
    celulaName?: string;
    members?: Array<{ id: string; name: string }>;
    meetingDate?: string;            // ISO date
    selectedMemberIds?: string[];
    selectedMemberNames?: string[];
    visitorsCount?: number;
    offerAmount?: number;
    offerSentToLeader?: boolean | null;
    offerTransferMethod?: 'fisico' | 'pix' | null;
    editingReportId?: string;        // only for edit flow
    revision?: number;               // only for edit flow
};
```

### C2) Celula resolution

Call `UvasProjectAdapter.getCelulasByLeader(project, waId)`:
- If one celula: auto-select, inform user, advance to `AWAITING_MEETING_DATE`.
- If multiple: store list in `contextJson.celulas`, set step `AWAITING_CELULA_SELECTION`, send numbered list.

### C3) Step 1 - Meeting date

Step: `AWAITING_MEETING_DATE`

Ask:
```
Qual a data da reuniao? (DD/MM ou hoje)
```

Parse rules:
- `hoje` → today's ISO date
- `DD/MM` → assume current year, normalize to ISO
- Store in `contextJson.meetingDate`

### C4) Step 2 - Member selection

Step: `AWAITING_MEMBER_SELECTION`

Call `UvasProjectAdapter.getMembersByCelula(project, celulaId)` and store in `contextJson.members`.

Send:
```
Quem foi na celula? Responda com numeros ou nomes separados por virgula.
1) Ana Silva
2) Bruno Santos
...
```

Parse rules:
- Accept numbers and names.
- Separators: comma, semicolon, ` e `.
- Remove duplicates.
- If ambiguous names, prompt disambiguation before advancing.
- Store parsed IDs/names in `contextJson.selectedMemberIds` and `contextJson.selectedMemberNames`.

Step: `AWAITING_MEMBER_CONFIRMATION`

Send:
```
Membros selecionados: Ana Silva, Bruno Santos.
Confirmar membros? (sim ou editar)
```
- `sim` → advance
- `editar` → go back to `AWAITING_MEMBER_SELECTION`

### C5) Step 3 - Visitors count

Step: `AWAITING_VISITORS_COUNT`

Ask:
```
Quantos visitantes estiveram presentes?
```
- Validate: integer >= 0
- Store in `contextJson.visitorsCount`

### C6) Step 4 - Offer amount

Step: `AWAITING_OFFER_AMOUNT`

Ask:
```
Qual foi o valor da oferta?
```
- Validate: decimal >= 0, normalize BRL format (accept `50`, `50,00`, `R$ 50`)
- Store in `contextJson.offerAmount`

### C7) Step 5 - Offer sent and method

Step: `AWAITING_OFFER_SENT_CONFIRMATION` (skip if offerAmount = 0)

If `offerAmount = 0`:
- Set `offerSentToLeader = null`, `offerTransferMethod = null`
- Jump to `AWAITING_FINAL_CONFIRMATION`

If `offerAmount > 0`:
- Ask: `A oferta ja foi enviada ao lider? (sim ou nao)`
- If `nao`: set `offerSentToLeader = false`, jump to `AWAITING_FINAL_CONFIRMATION`
- If `sim`: set `offerSentToLeader = true`, advance to `AWAITING_OFFER_TRANSFER_METHOD`

Step: `AWAITING_OFFER_TRANSFER_METHOD`

Ask:
```
Como foi enviada? (fisico ou pix)
```
- Store in `contextJson.offerTransferMethod`

### C8) Step 6 - Final confirmation

Step: `AWAITING_FINAL_CONFIRMATION`

Send summary:
```
Confirma os dados?
Projeto: Portal Uvas
Celula: <celulaName>
Data: <meetingDate formatted DD/MM/YYYY>
Presentes: <selectedMemberNames joined>
Visitantes: <visitorsCount>
Oferta: R$ <offerAmount>
Enviada ao lider: Sim | Nao | -
Forma: Fisico | Pix | -

Responda SIM para salvar ou EDITAR para corrigir.
```

- `SIM` → proceed to C9
- `EDITAR` → go back to `AWAITING_MEETING_DATE` (re-run wizard with prefilled values)

### C9) Create report

On `SIM`:
1. Insert `UvasCelulaAttendanceReport` row in local DB.
2. Call `UvasProjectAdapter.postAttendanceReport(project, celulaId, payload)`.
3. Insert `UvasActionExecution` audit row.
4. Update matching `UvasExpectedWeeklyReport` with `submittedAt = now()`.
5. Reset session to `IDLE` via `sessionService.clearActiveProject` (or a lighter reset that keeps `activeProjectId`).
6. Send confirmation message.

On API failure:
1. Mark audit row as failed with error.
2. Send: `Houve um erro ao salvar o relatorio. Tente novamente enviando: preencher relatorio`

---

## Part D: Full Wizard - Celula Service Attendance Report

Simpler flow — no visitors or offer questions.

### D1) contextJson steps used

- `AWAITING_CELULA_SELECTION`
- `AWAITING_SERVICE_DATE`
- `AWAITING_SERVICE_MEMBER_SELECTION`
- `AWAITING_SERVICE_CONFIRMATION`

### D2) Steps

1. Resolve celula (same logic as Part C2).
2. Ask date: `Qual a data do culto? (DD/MM ou hoje)` — same parse rules.
3. Fetch members, show roster, accept numbers or names.
4. Show summary and ask `SIM` or `EDITAR`.
5. Insert `UvasCelulaServiceAttendanceReport`, call adapter, audit, mark expected report.

---

## Part E: Edit Existing Report Flow

### E1) Entry

Trigger: `editar relatorio` or option `3` from initial menu.

Set:
- `currentActionKey = 'uvas.edit_report'`
- `contextJson = { step: 'AWAITING_EDIT_REPORT_TYPE' }`

Ask:
```
Escolha o tipo:
1) Celula
2) Culto
```

### E2) List editable reports

Step: `AWAITING_EDIT_REPORT_SELECTION`

Query `UvasCelulaAttendanceReport` or `UvasCelulaServiceAttendanceReport` for last 8 weeks by `leaderContactId`.

Send numbered list:
```
Escolha o relatorio para editar:
1) 05/05/2026 - Celula Casais Norte
2) 28/04/2026 - Celula Casais Norte
```

Store selected `reportId` and `revision` in `contextJson`.

### E3) Edit strategy

Step: `AWAITING_EDIT_FIELD_SELECTION`

Send:
```
O que deseja editar?
1) Membros
2) Visitantes
3) Oferta
4) Envio da oferta
5) Reabrir wizard completo
```

On option 5: re-run full wizard with `contextJson` prefilled from report data.

On options 1–4: jump directly to the relevant step, then go to `AWAITING_FINAL_CONFIRMATION`.

### E4) Save edited report

1. Show updated summary.
2. On `SIM`: update DB record with incremented `revision`.
3. Call `UvasProjectAdapter.patchReport(project, reportId, payload)`.
4. Insert `UvasActionExecution` audit with `previousPayload` populated.
5. Reset session.

---

## Part F: Prisma Models

Add to `prisma/schema.prisma`. Run `prisma migrate dev` after.

```prisma
model UvasCelulaAttendanceReport {
  id                   String    @id @default(cuid())
  leaderContactId      String    @map("leader_contact_id")
  leaderContact        Contact   @relation(fields: [leaderContactId], references: [id])
  churchId             String    @map("church_id")
  celulaId             String    @map("celula_id")
  celulaName           String    @map("celula_name")
  meetingDate          DateTime  @map("meeting_date") @db.Date
  attendeeMemberIds    Json      @map("attendee_member_ids")
  visitorsCount        Int       @map("visitors_count")
  offerAmount          Decimal   @map("offer_amount") @db.Decimal(10, 2)
  offerSentToLeader    Boolean?  @map("offer_sent_to_leader")
  offerTransferMethod  String?   @map("offer_transfer_method") // "fisico" | "pix"
  revision             Int       @default(1)
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt @map("updated_at")

  @@map("uvas_celula_attendance_reports")
}

model UvasCelulaServiceAttendanceReport {
  id                String    @id @default(cuid())
  leaderContactId   String    @map("leader_contact_id")
  leaderContact     Contact   @relation(fields: [leaderContactId], references: [id])
  churchId          String    @map("church_id")
  celulaId          String    @map("celula_id")
  celulaName        String    @map("celula_name")
  serviceDate       DateTime  @map("service_date") @db.Date
  attendeeMemberIds Json      @map("attendee_member_ids")
  revision          Int       @default(1)
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@map("uvas_celula_service_attendance_reports")
}

model UvasActionExecution {
  id              String    @id @default(cuid())
  actionKey       String    @map("action_key")
  reportType      String?   @map("report_type")
  projectId       Int       @map("project_id")
  project         Project   @relation(fields: [projectId], references: [id])
  contactId       String    @map("contact_id")
  contact         Contact   @relation(fields: [contactId], references: [id])
  rawUserInput    String?   @map("raw_user_input") @db.Text
  parsedPayload   Json?     @map("parsed_payload")
  previousPayload Json?     @map("previous_payload")
  status          String    // "CREATED" | "FAILED"
  error           String?   @db.Text
  executedAt      DateTime  @default(now()) @map("executed_at")

  @@map("uvas_action_executions")
}

model UvasExpectedWeeklyReport {
  id                String    @id @default(cuid())
  weekKey           String    @map("week_key")
  celulaId          String    @map("celula_id")
  celulaName        String    @map("celula_name")
  leaderContactId   String    @map("leader_contact_id")
  leaderContact     Contact   @relation(fields: [leaderContactId], references: [id])
  reportType        String    @map("report_type") // "celula" | "culto"
  submittedAt       DateTime? @map("submitted_at")
  reminderD1SentAt  DateTime? @map("reminder_d1_sent_at")
  reminderD3SentAt  DateTime? @map("reminder_d3_sent_at")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@unique([weekKey, celulaId, reportType])
  @@map("uvas_expected_weekly_reports")
}
```

---

## Part G: Uvas Adapter API Endpoints

These are called from `UvasProjectAdapter` using the project's `apiUrl` and `apiKey` (`X-API-KEY` header).

```
GET    {apiUrl}/uvas/leaders/{waId}/celulas
GET    {apiUrl}/uvas/celulas/{celulaId}/members
POST   {apiUrl}/uvas/celulas/{celulaId}/attendance-reports
POST   {apiUrl}/uvas/celulas/{celulaId}/service-attendance-reports
PATCH  {apiUrl}/uvas/reports/{reportId}
```

---

## Part H: Files to Create or Modify

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add 4 new models above |
| `prisma/migrations/...` | Run `prisma migrate dev` |
| `src/modules/whatsapp/actions/uvas/fill-celula-report.action.ts` | Create — main wizard handler |
| `src/modules/whatsapp/actions/uvas/register-attendance.action.ts` | Modify — implement or delegate to fill-celula-report |
| `src/modules/whatsapp/actions/uvas/fill-report-reminder.action.ts` | Modify — implement reminder send logic |
| `src/modules/whatsapp/actions/uvas/uvas-action.types.ts` | Modify — extend types with wizard payload |
| `src/modules/whatsapp/actions/uvas/index.ts` | Modify — export new handler |
| `src/modules/whatsapp/actions/action-router.service.ts` | Modify — inject and register new handler |
| `src/modules/whatsapp/integrations/adapters/uvas-project.adapter.ts` | Modify — add API methods |
| `src/modules/whatsapp/whatsapp.module.ts` | Modify — provide new handler class |
| `src/modules/queue/` | Modify — add `uvas-reminders` queue and processor |

---

## Part I: Conversation Examples

### I1) Celula attendance creation

```
User:  preencher relatorio
Bot:   Escolha o tipo de relatorio:
       1) Relatorio de presenca da celula
       2) Relatorio de presenca no culto da celula
       3) Editar relatorio existente

User:  1
Bot:   Voce lidera mais de uma celula. Escolha:
       1) Jovens Centro
       2) Casais Norte

User:  2
Bot:   Qual a data da reuniao? (DD/MM ou hoje)

User:  hoje
Bot:   Quem foi na celula? Responda com numeros ou nomes separados por virgula.
       1) Ana Silva
       2) Bruno Santos
       3) Carla Lima
       4) Diego Rocha

User:  1,2,4
Bot:   Membros selecionados: Ana Silva, Bruno Santos, Diego Rocha.
       Confirmar membros? (sim ou editar)

User:  sim
Bot:   Quantos visitantes estiveram presentes?

User:  2
Bot:   Qual foi o valor da oferta?

User:  50
Bot:   A oferta ja foi enviada ao lider? (sim ou nao)

User:  sim
Bot:   Como foi enviada? (fisico ou pix)

User:  pix
Bot:   Confirma os dados?
       Projeto: Portal Uvas
       Celula: Casais Norte
       Data: 11/05/2026
       Presentes: Ana Silva, Bruno Santos, Diego Rocha
       Visitantes: 2
       Oferta: R$ 50,00
       Enviada ao lider: Sim
       Forma: Pix

       Responda SIM para salvar ou EDITAR para corrigir.
```

### I2) Service attendance creation

```
User:  preencher relatorio
User:  2
Bot:   Qual a data do culto? (DD/MM ou hoje)

User:  08/05
Bot:   Quais membros da celula foram ao culto? Responda com numeros ou nomes.
       1) Ana Silva
       2) Bruno Santos
       3) Carla Lima

User:  Ana Silva, Carla Lima
Bot:   Confirma?
       Relatorio de culto
       Celula: Jovens Centro
       Data: 08/05/2026
       Presentes no culto: Ana Silva, Carla Lima

       Responda SIM ou EDITAR.
```

### I3) Edit existing report

```
User:  editar relatorio
Bot:   Escolha o tipo:
       1) Celula
       2) Culto

User:  1
Bot:   Escolha o relatorio para editar:
       1) 05/05/2026 - Celula Casais Norte
       2) 28/04/2026 - Celula Casais Norte

User:  1
Bot:   O que deseja editar?
       1) Membros
       2) Visitantes
       3) Oferta
       4) Envio da oferta
       5) Reabrir wizard completo
```

---

## Final Recommendation

Implement in this order:
1. Add Prisma models and run migration.
2. Implement `UvasProjectAdapter` API methods.
3. Implement the main wizard handler (`fill-celula-report.action.ts`) covering both report types and edit flow.
4. Implement `UvasFillReportReminderAction` and wire into a daily BullMQ job.
5. Register everything in `ActionRouterService` and `WhatsappModule`.

Keep validation, confirmation, and persistence fully deterministic. AI can be added later only as an optional parsing aid for member name disambiguation.