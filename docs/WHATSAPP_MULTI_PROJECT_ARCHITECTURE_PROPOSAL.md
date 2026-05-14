# WhatsApp Multi-Project Architecture Proposal

## Objective

Design a maintainable architecture for a single WhatsApp bot backend that supports multiple projects, clear user project switching, project-specific actions, and future AI-assisted flows (Python + Agno), while keeping webhook processing fast and reliable.

This proposal is based on the current implementation in `whatsapp-pelezi-bot-api/src/modules/whatsapp/service/whatsapp.service.ts` and related module boundaries.

## Current State Analysis (What Is Working and What Will Become Hard)

### What already works well

- Incoming webhook is handled in a single place and persists messages quickly.
- You already support contacts in multiple projects using:
  - `projectId`
  - `pendingProjectSelection`
  - `availableProjectIds`
- You already support reset/switch behavior using text commands like `0` and `trocar projeto`.
- Conversation/message history and media persistence are already integrated.
- There is foundation for project-authenticated APIs via `externalApiKey`.

### Main architecture risks as features grow

1. **God service risk**
   - `WhatsappService` mixes webhook transport, contact resolution, project membership checks, state transitions, action routing, media handling, message persistence, notification fanout, and template sends.
   - Adding new project-specific actions (Uvas, Talentos, future projects) will increase complexity very fast.

2. **State encoded as ad-hoc fields**
   - `pendingProjectSelection` + comma-separated `availableProjectIds` is enough now, but hard to extend for:
     - temporary workflows
     - multi-step forms
     - command context
     - retries and expiration

3. **Action routing is text-coupled and centralized**
   - Currently command-like behavior lives inside `processMessageLogic`.
   - Future project-specific action trees will create long if/else chains.

4. **External project membership checks are synchronous and repeated**
   - Membership checks call each project API in parallel per contact and cache in memory only.
   - In-memory cache/locks do not scale across multiple instances/pods.

5. **No explicit domain boundaries**
   - No clear contracts between:
     - WhatsApp transport layer
     - conversation/session domain
     - project capability adapters
     - action orchestration

6. **No first-class workflow/session model**
   - Hard to support robust guided flows such as:
     - "Registrar transação"
     - "Registrar presença da célula"
     - AI-assisted slots extraction + confirmation

## Target Architecture (Recommended)

Use a layered and modular architecture with explicit domain services and plugin-like project action handlers.

### High-level layers

1. **Transport Layer**
   - Webhook Controller
   - WhatsApp API Gateway
   - DTO parsing and signature/token validation

2. **Application Layer (Orchestration)**
   - InboundMessageOrchestrator
   - StatusUpdateOrchestrator
   - ActionRouter
   - SessionStateMachine

3. **Domain Layer**
   - ContactDomainService
   - ProjectContextService
   - ConversationService
   - MessageService
   - ProjectMembershipService

4. **Integration Layer**
   - ProjectAdapterRegistry (Uvas, Talentos, etc.)
   - NotificationPublisher
   - MediaStorageService
   - AI Orchestrator Client (future Python/Agno)

5. **Infrastructure Layer**
   - Prisma repositories
   - Redis cache + locks
   - Queue workers (BullMQ or equivalent)
   - Observability (logs, metrics, traces)

## Suggested Module Structure (NestJS)

```text
src/modules/whatsapp/
  webhook/
    webhook.controller.ts
    inbound-webhook.handler.ts
    status-webhook.handler.ts
  application/
    inbound-message.orchestrator.ts
    action-router.service.ts
    state-machine.service.ts
  domain/
    contact.service.ts
    conversation.service.ts
    message.service.ts
    project-context.service.ts
    membership.service.ts
  actions/
    common/
      help.action.ts
      switch-project.action.ts
      menu.action.ts
    uvas/
      register-cell-attendance.action.ts
      list-cell-members.action.ts
    talentos/
      register-transaction.action.ts
      transaction-summary.action.ts
  integrations/
    whatsapp-gateway.service.ts
    media-storage.service.ts
    notification-publisher.service.ts
    ai-agent-client.service.ts
  repositories/
    contact.repository.ts
    conversation.repository.ts
    message.repository.ts
    session.repository.ts
```

## Core Concept: Session + State Machine

Replace implicit state with explicit session records.

### New entity proposal: `ConversationSession`

```text
ConversationSession
- id
- contactId
- activeProjectId (nullable)
- availableProjectIds (json array)
- state (enum)
- currentActionKey (nullable)
- contextJson (json)
- expiresAt
- updatedAt
```

### State enum proposal

- `IDLE`
- `AWAITING_PROJECT_SELECTION`
- `AWAITING_ACTION_SELECTION`
- `AWAITING_ACTION_INPUT`
- `AWAITING_CONFIRMATION`
- `PROCESSING_ASYNC`

This gives predictable transitions and easier tests.

## Project Context and Switching Design

### Principle

Every inbound message should execute under a deterministic project context.

### Resolution order

1. If session has valid `activeProjectId`, use it.
2. Else resolve memberships.
3. If one project, auto-select and explain to user.
4. If multiple projects, move to `AWAITING_PROJECT_SELECTION` and prompt numbered options.
5. If none, show explicit guidance and fallback help.

### Commands for switching

Support user-friendly aliases:

- `projetos` (list available)
- `trocar projeto`
- `mudar projeto`
- `usar projeto 2`
- `menu`
- `ajuda`

### UX recommendation for project switch copy

- Always show:
  - selected project
  - available commands for that project
  - how to switch again

Example message:

```text
Projeto ativo: Talentos Money Manager

Comandos disponíveis:
1) nova transacao
2) resumo mes
3) categorias

Para trocar de projeto, envie: trocar projeto
```

## Action Routing Model (Scalable for Many Projects)

### Registry-based action handlers

Each action handler declares:

- `actionKey`
- `supportedProjects`
- `canHandle(message, session)`
- `handle(message, session)`

Pseudo-interface:

```ts
interface ActionHandler {
  actionKey: string;
  supportedProjects: string[]; // ex: ['uvas', 'talentos'] or ['*']
  canHandle(input: ParsedInput, session: Session): boolean;
  handle(input: ParsedInput, session: Session): Promise<ActionResult>;
}
```

### Why this is better

- New project action = new file/class, minimal risk to existing flows.
- Removes giant `if/else` blocks from main service.
- Clear unit tests per action.

## Project Adapter Pattern (Integration with each platform)

Introduce adapters for each external system.

### Adapter interface

```ts
interface ProjectAdapter {
  projectSlug: string;
  verifyMembership(phone: string): Promise<boolean>;
  executeAction(actionKey: string, payload: any, authContext: any): Promise<any>;
  listAvailableActions(): ActionDescriptor[];
}
```

### Concrete adapters

- `UvasProjectAdapter`
- `TalentosProjectAdapter`

### Benefits

- Each project integration details are isolated.
- API keys, endpoints, and payload maps stay in one place.
- Easier retries/circuit-breakers per project.

## AI Integration Strategy (Future Python + Agno)

Keep AI as an optional orchestration dependency, not the source of truth.

### Recommended pattern

1. TypeScript orchestrator receives inbound text.
2. It can call Python AI service for:
   - intent extraction
   - slot filling
   - natural language to structured command
3. TS orchestrator validates permissions and session state.
4. TS orchestrator calls project adapter action.
5. AI only assists; final action execution remains deterministic in backend.

### AI service contract (example)

```json
{
  "project": "talentos",
  "intent": "register_transaction",
  "confidence": 0.92,
  "entities": {
    "amount": 150.75,
    "category": "alimentacao",
    "date": "2026-05-08",
    "description": "almoco equipe"
  },
  "needsConfirmation": true,
  "missingFields": []
}
```

### Safety rules for AI-assisted actions

- Require confirmation for mutating operations.
- Persist normalized command payload before execution.
- Log model output and final executed payload for audit.

## Data Model Improvements

### Keep

- `Contact`, `Conversation`, `Message`

### Add

1. `ConversationSession` (state machine)
2. `ContactProjectMembership` (optional but recommended)
   - avoids comma-separated IDs
   - supports metadata (source, checkedAt, confidence)
3. `ActionExecution`
   - audit trail for project actions
   - status, payload, result summary, error

### Optional event table

- `InboundEvent`
  - idempotency key
  - raw payload
  - processing status

Useful for retries and replay in failures.

## Webhook Processing Best Practices

### Inbound message path

1. Receive webhook.
2. Validate and persist raw event quickly.
3. Ack 200 fast.
4. Enqueue processing job.
5. Worker executes orchestration.

This avoids webhook timeouts and gives resilience under spikes.

### Idempotency

- Use WhatsApp message id as idempotency key.
- Ignore duplicates safely.

### Concurrency

- Lock by `contactId` or `waId` while processing one message flow.
- Use distributed lock (Redis) to support multi-instance deployment.

## Messaging UX Recommendations

For users in many projects, clarity matters more than cleverness.

### Rules

- Every important bot response should include current project label.
- For errors, always provide next valid command.
- For multi-step actions, show progress indicator:
  - `Passo 1 de 3`, `Passo 2 de 3`
- After project switch, show concise project-specific menu.

### Standard response envelope

- Header: active project
- Body: action result/request
- Footer: help/switch hint

## Security and Governance

- Keep API key per project (`externalApiKey`) but rotate keys periodically.
- Add outbound request signing to project adapters where possible.
- Validate action authorization by project + user membership before mutation.
- Rate limit high-risk commands (financial operations, bulk updates).
- Store audit logs for all mutating actions.

## Observability and Operations

Track metrics per project and per action:

- inbound messages count
- project resolution latency
- action success/failure rate
- external API latency/error by adapter
- AI confidence and confirmation rate

Use structured logs with fields:

- `conversationId`
- `contactId`
- `activeProjectId`
- `actionKey`
- `state`
- `traceId`

## Migration Plan (Low-Risk Incremental)

### Phase 1: Refactor boundaries without behavior changes

- Extract from `WhatsappService` into:
  - message persistence service
  - project context service
  - outbound messenger service
- Keep current data model.

### Phase 2: Introduce session state machine

- Add `ConversationSession` table.
- Replace `pendingProjectSelection` and `availableProjectIds` usage in logic.
- Keep backward compatibility temporarily.

### Phase 3: Add action router + handlers

- Implement common actions (`menu`, `trocar projeto`, `ajuda`).
- Move project-specific logic to dedicated handler classes.

### Phase 4: Add adapter registry per project

- Introduce Uvas and Talentos adapters.
- Move membership checks and action APIs to adapters.

### Phase 5: Queue + distributed cache/locks

- Move webhook processing to background jobs.
- Replace in-memory locks/cache with Redis-backed services.

### Phase 6: AI integration

- Add AI client contract and "assist mode" for parsing.
- Keep deterministic confirmations for writes.

## Suggested First Deliverables (Practical Next Sprint)

1. `ConversationSession` Prisma model + migration.
2. `ProjectContextService` with explicit `resolveActiveProject()`.
3. `ActionRouterService` with 3 built-in commands:
   - `menu`
   - `trocar projeto`
   - `ajuda`
4. `UvasProjectAdapter` and `TalentosProjectAdapter` skeletons.
5. Replace direct project-check cache maps with a `MembershipService` abstraction.

## Acceptance Criteria for the New Structure

- Adding a new project action requires creating one new handler class only.
- User can switch project in 1 command at any time.
- Bot always indicates active project in actionable responses.
- Mutating operations are auditable and confirmable.
- Webhook request path is non-blocking and idempotent.
- Multi-instance deployment behaves consistently (no in-memory-only state dependency).

## Final Recommendation

For your roadmap (Uvas + Talentos + future AI), the key is to treat WhatsApp inbound processing as an orchestration problem with explicit state and pluggable project capabilities.

If you adopt the session state machine + action router + adapter registry now, your future Python/Agno service can plug in cleanly as an assistant layer, without turning the core backend into a brittle monolith.