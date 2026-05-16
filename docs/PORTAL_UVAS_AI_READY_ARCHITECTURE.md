# Portal Uvas: AI-Ready Architecture (No-AI Now, AI Later)

## Overview

This document describes the recommended architecture for Portal Uvas WhatsApp features to ship them **safely and quickly without AI**, while designing clean seams for **AI to integrate later without breaking existing logic**.

The key principle: **Separate business workflow from input interpretation.**

- **Business Workflow** = deterministic state machine (no AI, always predictable)
- **Input Interpretation** = pluggable layer (rule-based now, AI later)

This approach gives you:
- ✅ Ship reliable features now (no hallucination risk)
- ✅ Testable, auditable business logic (critical for attendance/money tracking)
- ✅ Minimal refactoring when AI arrives
- ✅ Easy fallback to rules if AI fails

---

## Portal Uvas Features Overview

Current Portal Uvas WhatsApp flows:

1. **Celula Attendance Report**
   - Leader reports members present/absent
   - Tracks visitors
   - Records offering amount and method

2. **Celula Service Attendance Report**
   - Similar to attendance but for service/worship events
   - Different member set vs. regular celula meetings

Both flows can be extended later with:
- Automatic member name/phone recognition (AI)
- Natural language amount parsing ("mil reais" → 1000)
- Intent detection ("skip this week", "save for later")
- Conversational clarifications

---

## Architecture Pattern

### Layer 1: Deterministic Business Flow

**Purpose:** Execute the workflow step-by-step, no randomness or learning.

**Owns:**
- State transitions (which step comes next)
- Validation rules (numeric ranges, required fields)
- Data persistence
- Confirmations before writes
- Audit trail

**Example: Attendance Report Flow**
```
1. AWAITING_REPORT_TYPE
   ├─ Show: "Attendance or Service report?"
   └─ Next: AWAITING_CELULA_SELECTION

2. AWAITING_CELULA_SELECTION
   ├─ Show: "Which celula?"
   └─ Next: AWAITING_MEMBERS_ATTENDANCE

3. AWAITING_MEMBERS_ATTENDANCE
   ├─ Show: "Who was present?" (names + numbers)
   └─ Next: AWAITING_VISITORS_COUNT

4. AWAITING_VISITORS_COUNT
   ├─ Show: "How many visitors?"
   └─ Next: AWAITING_OFFER_AMOUNT

5. AWAITING_OFFER_AMOUNT
   ├─ Show: "Offering amount?"
   └─ Next: AWAITING_CONFIRMATION

6. AWAITING_CONFIRMATION
   ├─ Show: "[Summary] Submit? (Y/N)"
   └─ Next: PROCESSING_ASYNC (writes to DB)
```

This flow **never changes**. It is the ground truth for your domain logic.

### Layer 2: Input Interpretation (Rule-Based Now)

**Purpose:** Convert user's free text into normalized commands that the business flow understands.

**Owns:**
- Parsing numbers ("123", "1,2,3", "123-125")
- Parsing yes/no ("sim", "yes", "ok", "confirmo")
- Parsing money ("1000", "mil", "1.000,00")
- Parsing dates (later, if needed)
- Validation of input for current step

**What it does NOT own:**
- ❌ Deciding which step comes next (that's Layer 1)
- ❌ Storing state (that's Layer 1)
- ❌ Confirmation logic (that's Layer 1)

**Example: Rule-Based Interpreter**
```typescript
// For AWAITING_MEMBERS_ATTENDANCE step:
parseUserInput(rawText: string) {
  const normalized = rawText.toLowerCase().trim();
  
  // Pattern 1: Numbers "1,2,3"
  if (/^\d+[\d,\s\-]*$/.test(rawText)) {
    const memberIds = parseNumberList(rawText); // [1, 2, 3]
    return { type: 'SET_MEMBERS', memberIds };
  }
  
  // Pattern 2: Names "João, Maria"
  if (hasAlphaChars(normalized)) {
    const names = normalized.split(',').map(n => n.trim());
    return { type: 'SET_MEMBERS_BY_NAME', names };
  }
  
  // Pattern 3: Unknown
  return { type: 'UNCLEAR', suggestion: 'Send numbers or names' };
}
```

### Layer 3: AI Input Interpreter (Future)

Same interface as rule-based, but uses LLM:

```typescript
// Later implementation:
async parseUserInput(rawText: string) {
  try {
    const prompt = buildContextualPrompt(rawText, this.currentStep);
    const aiResponse = await llm.complete(prompt);
    const parsed = extractCommand(aiResponse);
    
    // Validate confidence
    if (parsed.confidence < 0.85) {
      return { type: 'UNCLEAR', suggestion: '...' };
    }
    
    return { type: parsed.commandType, ...parsed.payload };
  } catch (error) {
    // Fallback to rules
    return this.ruleBased.parseUserInput(rawText);
  }
}
```

**Key:** Same output contract. Flow layer doesn't know the difference.

---

## Concrete Implementation: Attendance Action

### Folder Structure

```
src/modules/whatsapp/
├── actions/
│   └── uvas/
│       ├── attendance-wizard.action.ts       # Entry point + main handler
│       ├── attendance-step.handlers.ts       # Sub-step logic
│       └── index.ts
├── domain/
│   ├── attendance/
│   │   ├── attendance-flow.service.ts        # State machine + transitions
│   │   ├── attendance-validation.service.ts  # Field validators
│   │   └── attendance-state.types.ts         # Types for flow
│   └── services/
│       └── input-interpretation/
│           ├── attendance-input-interpreter.interface.ts
│           ├── rule-based.interpreter.ts     # v1: current
│           └── ai.interpreter.ts              # v2: future
└── integrations/
    └── adapters/
        └── uvas-project.adapter.ts            # API calls only
```

### 1. Attendance Action Handler

**File:** `src/modules/whatsapp/actions/uvas/attendance-wizard.action.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';
import { ConversationSessionService } from '../../service/conversation-session.service';
import { AttendanceFlowService } from '../../domain/attendance/attendance-flow.service';
import { AttendanceInputInterpreter } from '../../domain/services/input-interpretation/attendance-input-interpreter.interface';

@Injectable()
export class AttendanceWizardAction implements ActionHandler {
  readonly actionKey = 'uvas.attendance_wizard';

  constructor(
    private readonly sessionService: ConversationSessionService,
    private readonly flowService: AttendanceFlowService,
    private readonly inputInterpreter: AttendanceInputInterpreter,
  ) {}

  canHandle(context: ActionContext): boolean {
    const isAttendanceFlow = 
      context.session?.currentActionKey === this.actionKey &&
      context.session?.state === 'AWAITING_ACTION_INPUT';
    
    const isEntryCommand = 
      /^(preencher|relatorio|presenca)$/i.test(context.messageText);
    
    return isAttendanceFlow || isEntryCommand;
  }

  async handle(context: ActionContext): Promise<ActionResult> {
    const { dbContact, contactPayload, session, messageText, conversation } = context;

    // 1. Initialize or resume flow
    const state = await this.flowService.getOrInitializeState(
      dbContact.id,
      session,
      context.activeProjectId
    );

    // 2. Interpret user input for current step
    const normalizedCommand = await this.inputInterpreter.interpret(
      messageText,
      state.currentStep,
      state.context
    );

    // 3. Execute state transition
    const transition = await this.flowService.processCommand(
      dbContact.id,
      state,
      normalizedCommand
    );

    // 4. Send response message(s)
    if (transition.messages) {
      for (const message of transition.messages) {
        const sent = await this.outboundMessenger.sendTextMessage(
          contactPayload.wa_id,
          message.text
        );
        await this.messagePersistence.saveOutboundMessage(
          conversation.id,
          dbContact.id,
          message.text,
          sent?.messages?.[0]?.id
        );
      }
    }

    // 5. If flow completed, handle submission
    if (transition.completed) {
      await this.flowService.submitReport(
        dbContact.id,
        transition.reportData,
        context.activeProjectId
      );
    }

    // 6. If flow cancelled or errored, reset session
    if (transition.error || transition.cancelled) {
      await this.sessionService.clearActiveProject(dbContact.id);
    }

    return {
      handled: true,
      stopProcessing: true,
    };
  }
}
```

### 2. Flow Service (State Machine)

**File:** `src/modules/whatsapp/domain/attendance/attendance-flow.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common';
import { ConversationSessionService } from '../../service/conversation-session.service';

@Injectable()
export class AttendanceFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: ConversationSessionService,
    private readonly uvasAdapter: UvasProjectAdapter,
  ) {}

  /**
   * Get or initialize attendance flow state
   */
  async getOrInitializeState(contactId: string, session: any, projectId: number) {
    let state = session?.contextJson as AttendanceState;

    if (!state || state.flowId !== 'attendance') {
      // New flow: start at report type selection
      state = {
        flowId: 'attendance',
        step: 'AWAITING_REPORT_TYPE',
        data: {},
        startedAt: new Date(),
        celulaId: null,
        memberIds: [],
        visitorsCount: null,
        offerAmount: null,
      };

      await this.sessionService.updateSession(contactId, {
        state: 'AWAITING_ACTION_INPUT',
        currentActionKey: 'uvas.attendance_wizard',
        contextJson: state,
      });
    }

    return state;
  }

  /**
   * Process normalized command and transition state
   */
  async processCommand(
    contactId: string,
    state: AttendanceState,
    command: NormalizedCommand
  ): Promise<StateTransition> {
    const currentStep = state.step;

    if (command.type === 'CANCEL') {
      return {
        messages: [{ text: '❌ Cancelado. Envie uma mensagem quando precisar.' }],
        cancelled: true,
      };
    }

    // Delegate to step-specific handler
    const handler = this.getStepHandler(currentStep);
    const transition = await handler.handle(state, command);

    if (!transition.error) {
      // Persist new state
      await this.sessionService.updateSession(contactId, {
        contextJson: { ...state, step: transition.nextStep, ...transition.stateUpdates },
      });
    }

    return transition;
  }

  /**
   * Validate and submit report to Uvas API
   */
  async submitReport(
    contactId: string,
    reportData: AttendanceReportData,
    projectId: number
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });

    // Call adapter to create report
    const result = await this.uvasAdapter.createAttendanceReport(
      project,
      reportData
    );

    // Store submission audit
    await this.prisma.uvasAttendanceReport.create({
      data: {
        contactId,
        projectId,
        celulaId: reportData.celulaId,
        memberIds: reportData.memberIds,
        visitorsCount: reportData.visitorsCount,
        offerAmount: reportData.offerAmount,
        externalReportId: result.id,
        submittedAt: new Date(),
      },
    });
  }

  private getStepHandler(step: string): StepHandler {
    // Delegate to appropriate handler
    // (see next section)
  }
}
```

### 3. Step Handlers

**File:** `src/modules/whatsapp/actions/uvas/attendance-step.handlers.ts`

```typescript
import { Injectable } from '@nestjs/common';

/**
 * Handles AWAITING_REPORT_TYPE step
 */
@Injectable()
export class ReportTypeStepHandler implements StepHandler {
  async handle(
    state: AttendanceState,
    command: NormalizedCommand
  ): Promise<StateTransition> {
    if (command.type === 'SELECT_OPTION') {
      const reportType = command.payload.option; // "attendance" | "service"

      if (!['attendance', 'service'].includes(reportType)) {
        return {
          error: true,
          messages: [{ text: '⚠️ Opção inválida. Escolha 1 ou 2.' }],
        };
      }

      return {
        nextStep: 'AWAITING_CELULA_SELECTION',
        stateUpdates: { reportType },
        messages: [{ text: '📋 Carregando células...' }],
      };
    }

    return { error: true, messages: [{ text: 'Responda com 1 ou 2.' }] };
  }
}

/**
 * Handles AWAITING_MEMBERS_ATTENDANCE step
 */
@Injectable()
export class MembersAttendanceStepHandler implements StepHandler {
  constructor(private readonly uvasAdapter: UvasProjectAdapter) {}

  async handle(
    state: AttendanceState,
    command: NormalizedCommand
  ): Promise<StateTransition> {
    if (command.type === 'SET_MEMBERS') {
      const { memberIds } = command.payload;

      // Validate that members exist in celula
      const celula = await this.uvasAdapter.getCelulaMembers(state.celulaId);
      const validIds = celula.members.map((m) => m.id);

      const invalidIds = memberIds.filter((id) => !validIds.includes(id));
      if (invalidIds.length > 0) {
        return {
          error: true,
          messages: [
            { text: `⚠️ IDs inválidos: ${invalidIds.join(', ')}. Tente novamente.` },
          ],
        };
      }

      return {
        nextStep: 'AWAITING_VISITORS_COUNT',
        stateUpdates: { memberIds },
        messages: [{ text: `✅ ${memberIds.length} membros registrados.\n\nQuantos visitantes?` }],
      };
    }

    return { error: true };
  }
}

/**
 * Handles AWAITING_OFFER_AMOUNT step
 */
@Injectable()
export class OfferAmountStepHandler implements StepHandler {
  async handle(
    state: AttendanceState,
    command: NormalizedCommand
  ): Promise<StateTransition> {
    if (command.type === 'SET_AMOUNT') {
      const amount = command.payload.amount; // Already normalized by interpreter

      if (amount < 0) {
        return {
          error: true,
          messages: [{ text: '⚠️ Valor não pode ser negativo.' }],
        };
      }

      let nextStep = 'AWAITING_CONFIRMATION';
      let messages = [];

      // If offer > 0, ask how it was sent
      if (amount > 0) {
        nextStep = 'AWAITING_OFFER_SENT_METHOD';
        messages = [{ text: '💰 Oferta registrada.\n\nComo foi enviada? (transferência/dinheiro)' }];
      } else {
        messages = [{ text: '💰 Nenhuma oferta registrada.' }];
      }

      return {
        nextStep,
        stateUpdates: { offerAmount: amount },
        messages,
      };
    }

    return { error: true };
  }
}

/**
 * Handles AWAITING_CONFIRMATION step
 */
@Injectable()
export class ConfirmationStepHandler implements StepHandler {
  async handle(
    state: AttendanceState,
    command: NormalizedCommand
  ): Promise<StateTransition> {
    if (command.type === 'CONFIRM') {
      return {
        nextStep: 'COMPLETED',
        completed: true,
        reportData: {
          celulaId: state.celulaId,
          reportType: state.reportType,
          memberIds: state.memberIds,
          visitorsCount: state.visitorsCount,
          offerAmount: state.offerAmount,
        },
        messages: [{ text: '✅ Relatório enviado com sucesso!' }],
      };
    }

    if (command.type === 'REJECT') {
      return {
        nextStep: 'AWAITING_EDIT_FIELD',
        messages: [{ text: 'Qual campo deseja editar?' }],
      };
    }

    return { error: true };
  }
}
```

### 4. Input Interpreter Interface

**File:** `src/modules/whatsapp/domain/services/input-interpretation/attendance-input-interpreter.interface.ts`

```typescript
export interface NormalizedCommand {
  type:
    | 'SELECT_OPTION'
    | 'SET_MEMBERS'
    | 'SET_AMOUNT'
    | 'CONFIRM'
    | 'REJECT'
    | 'CANCEL'
    | 'UNCLEAR';
  payload?: Record<string, any>;
  confidence?: number; // 0-1, used by AI interpreter
}

export interface AttendanceInputInterpreter {
  /**
   * Parse user's raw text for the current workflow step
   * @param rawText User's message (e.g., "1,2,3", "1000", "sim")
   * @param step Current step (e.g., "AWAITING_MEMBERS_ATTENDANCE")
   * @param context Additional context (celula members, etc.)
   * @returns Normalized command that flow service understands
   */
  interpret(
    rawText: string,
    step: string,
    context: Record<string, any>
  ): Promise<NormalizedCommand>;
}
```

### 5. Rule-Based Interpreter (v1)

**File:** `src/modules/whatsapp/domain/services/input-interpretation/rule-based.interpreter.ts`

```typescript
import { Injectable } from '@nestjs/common';
import {
  AttendanceInputInterpreter,
  NormalizedCommand,
} from './attendance-input-interpreter.interface';

@Injectable()
export class RuleBasedAttendanceInputInterpreter implements AttendanceInputInterpreter {
  async interpret(
    rawText: string,
    step: string,
    context: Record<string, any>
  ): Promise<NormalizedCommand> {
    const normalized = rawText.toLowerCase().trim();

    // === AWAITING_REPORT_TYPE ===
    if (step === 'AWAITING_REPORT_TYPE') {
      if (normalized === '1' || normalized === 'presenca') {
        return { type: 'SELECT_OPTION', payload: { option: 'attendance' } };
      }
      if (normalized === '2' || normalized === 'culto') {
        return { type: 'SELECT_OPTION', payload: { option: 'service' } };
      }
      return { type: 'UNCLEAR' };
    }

    // === AWAITING_MEMBERS_ATTENDANCE ===
    if (step === 'AWAITING_MEMBERS_ATTENDANCE') {
      // Pattern: "1,2,3" or "1-3" or just numbers
      const numberMatch = /^\d+[\d,\s\-]*$/.test(rawText);
      if (numberMatch) {
        const memberIds = this.parseNumberList(rawText);
        return { type: 'SET_MEMBERS', payload: { memberIds } };
      }

      // Pattern: "joão, maria" (names)
      const hasAlpha = /[a-záéíóú]/i.test(rawText);
      if (hasAlpha) {
        const names = rawText.split(',').map((n) => n.trim());
        return { type: 'SET_MEMBERS', payload: { names } };
      }

      return { type: 'UNCLEAR' };
    }

    // === AWAITING_OFFER_AMOUNT ===
    if (step === 'AWAITING_OFFER_AMOUNT') {
      const amount = this.parseAmount(rawText);
      if (amount !== null) {
        return { type: 'SET_AMOUNT', payload: { amount } };
      }
      return { type: 'UNCLEAR' };
    }

    // === AWAITING_CONFIRMATION ===
    if (step === 'AWAITING_CONFIRMATION') {
      if (normalized === 'sim' || normalized === 'yes' || normalized === 'ok') {
        return { type: 'CONFIRM' };
      }
      if (normalized === 'não' || normalized === 'no') {
        return { type: 'REJECT' };
      }
      return { type: 'UNCLEAR' };
    }

    // === Fallback: Check for cancel from any step ===
    if (normalized === 'cancelar' || normalized === 'cancel') {
      return { type: 'CANCEL' };
    }

    return { type: 'UNCLEAR' };
  }

  private parseNumberList(text: string): number[] {
    // "1,2,3" -> [1, 2, 3]
    // "1-3" -> [1, 2, 3]
    const ranges = text.split(',').map((r) => r.trim());
    const result: number[] = [];

    for (const range of ranges) {
      if (range.includes('-')) {
        const [start, end] = range.split('-').map((s) => parseInt(s));
        for (let i = start; i <= end; i++) {
          result.push(i);
        }
      } else {
        result.push(parseInt(range));
      }
    }

    return [...new Set(result)];
  }

  private parseAmount(text: string): number | null {
    // "1000" -> 1000
    // "1.000,00" -> 1000
    // "mil" -> 1000
    // "1k" -> 1000

    const normalized = text.toLowerCase().trim();

    // Handle "mil"
    if (normalized === 'mil') return 1000;

    // Handle "xk" (e.g., "2k" -> 2000)
    const kMatch = normalized.match(/^(\d+)k$/);
    if (kMatch) return parseInt(kMatch[1]) * 1000;

    // Handle "1.000,00" (PT-BR format)
    const ptMatch = normalized.match(/^(\d{1,3})\.?(\d{3}),(\d{2})$/);
    if (ptMatch) {
      return parseInt(ptMatch[1] + ptMatch[2]) + parseInt(ptMatch[3]) / 100;
    }

    // Handle plain numbers
    const numMatch = normalized.match(/^(\d+)$/);
    if (numMatch) return parseInt(numMatch[1]);

    return null;
  }
}
```

### 6. AI Interpreter (Future, v2)

**File:** `src/modules/whatsapp/domain/services/input-interpretation/ai.interpreter.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/provider';
import {
  AttendanceInputInterpreter,
  NormalizedCommand,
} from './attendance-input-interpreter.interface';
import { RuleBasedAttendanceInputInterpreter } from './rule-based.interpreter';

@Injectable()
export class AiAttendanceInputInterpreter implements AttendanceInputInterpreter {
  constructor(
    private readonly logger: LoggerService,
    private readonly ruleBased: RuleBasedAttendanceInputInterpreter,
    private readonly aiOrchestratorClient: AiOrchestratorClient, // Future: urbano vitalino
  ) {}

  async interpret(
    rawText: string,
    step: string,
    context: Record<string, any>
  ): Promise<NormalizedCommand> {
    try {
      // Build contextual prompt
      const prompt = this.buildPrompt(rawText, step, context);

      // Call AI orchestrator (urbano vitalino service)
      const aiResponse = await this.aiOrchestratorClient.extractCommand({
        prompt,
        allowedCommands: this.getAllowedCommandsForStep(step),
      });

      // Validate confidence
      if ((aiResponse.confidence ?? 0) < 0.75) {
        this.logger.warn(
          `Low AI confidence (${aiResponse.confidence}) for step ${step}, falling back to rules`
        );
        return this.ruleBased.interpret(rawText, step, context);
      }

      return {
        type: aiResponse.commandType,
        payload: aiResponse.payload,
        confidence: aiResponse.confidence,
      };
    } catch (error) {
      this.logger.error(`AI interpreter error, fallback to rules: ${error.message}`);
      return this.ruleBased.interpret(rawText, step, context);
    }
  }

  private buildPrompt(rawText: string, step: string, context: any): string {
    const stepDescriptions: Record<string, string> = {
      AWAITING_REPORT_TYPE: 'User choosing between attendance (1) or service (2) report',
      AWAITING_MEMBERS_ATTENDANCE: `User listing members present. Available members: ${JSON.stringify(context.availableMembers)}`,
      AWAITING_OFFER_AMOUNT: 'User specifying amount in reais (e.g., "1000", "mil", "1.000,00")',
      AWAITING_CONFIRMATION: 'User confirming or rejecting the summary',
    };

    return `
You are a WhatsApp message parser for a church attendance system.
Current step: ${step}
Step context: ${stepDescriptions[step] || 'Unknown step'}
User message: "${rawText}"
Available context: ${JSON.stringify(context)}

Extract the user's intent and return ONLY a JSON object (no markdown, no text):
{
  "commandType": "SELECT_OPTION" | "SET_MEMBERS" | "SET_AMOUNT" | "CONFIRM" | "REJECT" | "CANCEL" | "UNCLEAR",
  "payload": { /* relevant data */ },
  "confidence": 0.0-1.0
}
    `;
  }

  private getAllowedCommandsForStep(step: string): string[] {
    const commands: Record<string, string[]> = {
      AWAITING_REPORT_TYPE: ['SELECT_OPTION'],
      AWAITING_MEMBERS_ATTENDANCE: ['SET_MEMBERS'],
      AWAITING_OFFER_AMOUNT: ['SET_AMOUNT'],
      AWAITING_CONFIRMATION: ['CONFIRM', 'REJECT'],
    };
    return commands[step] || [];
  }
}
```

---

## Module Provider Configuration

**File:** `src/modules/whatsapp/whatsapp.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AttendanceWizardAction } from './actions/uvas/attendance-wizard.action';
import { AttendanceFlowService } from './domain/attendance/attendance-flow.service';
import { RuleBasedAttendanceInputInterpreter } from './domain/services/input-interpretation/rule-based.interpreter';
import { AiAttendanceInputInterpreter } from './domain/services/input-interpretation/ai.interpreter';

@Module({
  providers: [
    // ... existing providers

    // Attendance flow
    AttendanceWizardAction,
    AttendanceFlowService,
    AttendanceValidationService,

    // Input interpreters
    RuleBasedAttendanceInputInterpreter,

    // Provide the rule-based as default
    {
      provide: 'AttendanceInputInterpreter',
      useClass: RuleBasedAttendanceInputInterpreter,
    },

    // Later: Switch to AI based on feature flag
    // {
    //   provide: 'AttendanceInputInterpreter',
    //   useClass: AiAttendanceInputInterpreter,
    // }
  ],
})
export class WhatsappModule {}
```

---

## Applying This Pattern to Other Portal Uvas Features

### Service Attendance Report

The **Celula Service Attendance** follows the **exact same pattern**:

1. Create `ServiceAttendanceWizardAction` (entry + orchestration)
2. Create `ServiceAttendanceFlowService` (state machine)
3. Create step handlers (mostly copy from attendance, slight changes)
4. Reuse `AttendanceInputInterpreter` interface
5. Create `RuleBasedServiceAttendanceInputInterpreter` (v1)

**Differences from regular attendance:**
- Different celula context (service participants vs. weekly celula)
- Different optional fields (e.g., preacher name, sermon topic)

### Transaction Registration (Talentos)

Same 3-layer pattern:

1. `TransactionWizardAction` (entry)
2. `TransactionFlowService` (state machine)
3. Step handlers for each transaction field
4. `TransactionInputInterpreter` interface
5. `RuleBasedTransactionInputInterpreter` (v1)

**AI upgrade later:** LLM can parse "paguei 500 pro joão" → identify debtor, amount, date.

### Future Features

Any new guided flow (signup, feedback, etc.) follows the same pattern:

```
Feature
  ├── WizardAction (entry + orchestration)
  ├── FlowService (state machine)
  ├── StepHandlers (step-by-step logic)
  ├── InputInterpreter interface
  └── RuleBasedInterpreter (v1) → AIInterpreter (v2)
```

---

## Testing Strategy

### Unit Tests: Business Logic (No AI Mocking Needed)

```typescript
describe('AttendanceFlowService', () => {
  it('should transition from AWAITING_MEMBERS to AWAITING_VISITORS on valid command', async () => {
    const state = { step: 'AWAITING_MEMBERS', memberIds: [] };
    const command = { type: 'SET_MEMBERS', payload: { memberIds: [1, 2, 3] } };

    const transition = await flowService.processCommand(contactId, state, command);

    expect(transition.nextStep).toBe('AWAITING_VISITORS_COUNT');
    expect(transition.stateUpdates.memberIds).toEqual([1, 2, 3]);
  });

  it('should reject invalid member IDs', async () => {
    const command = { type: 'SET_MEMBERS', payload: { memberIds: [999] } };
    const transition = await handler.handle(state, command);

    expect(transition.error).toBe(true);
    expect(transition.messages[0].text).toContain('inválido');
  });
});
```

### Integration Tests: Input Parsing

```typescript
describe('RuleBasedAttendanceInputInterpreter', () => {
  it('should parse "1,2,3" as member IDs', async () => {
    const cmd = await interpreter.interpret('1,2,3', 'AWAITING_MEMBERS_ATTENDANCE', {});

    expect(cmd.type).toBe('SET_MEMBERS');
    expect(cmd.payload.memberIds).toEqual([1, 2, 3]);
  });

  it('should parse "1-3" as range', async () => {
    const cmd = await interpreter.interpret('1-3', 'AWAITING_MEMBERS_ATTENDANCE', {});

    expect(cmd.payload.memberIds).toEqual([1, 2, 3]);
  });

  it('should parse "mil" as 1000', async () => {
    const cmd = await interpreter.interpret('mil', 'AWAITING_OFFER_AMOUNT', {});

    expect(cmd.payload.amount).toBe(1000);
  });
});
```

### E2E Tests: Full Flow

```typescript
describe('Attendance WhatsApp Flow', () => {
  it('should complete attendance report from start to finish', async () => {
    // 1. User: "preencher" -> Bot: "Attendance or Service?"
    // 2. User: "1" -> Bot: "Which celula?"
    // 3. User: "My Celula" -> Bot: "Members present?"
    // 4. User: "1,2,3" -> Bot: "Visitors?"
    // 5. User: "2" -> Bot: "Offering?"
    // 6. User: "500" -> Bot: "[Summary] Confirm?"
    // 7. User: "sim" -> Bot: "✅ Submitted!"
  });
});
```

---

## Deployment Checklist

### v1 (No AI)

- [ ] Implement `AttendanceFlowService` and step handlers
- [ ] Implement `RuleBasedAttendanceInputInterpreter`
- [ ] Implement `AttendanceWizardAction`
- [ ] Wire action into `ActionRouterService`
- [ ] Add to WhatsApp module providers
- [ ] Add Prisma schema for `UvasAttendanceReport`
- [ ] Test all happy paths
- [ ] Test cancellation and error paths
- [ ] Deploy with feature flag (optional, but nice for gradual rollout)

### v2 (AI-Ready, No Code Change to Flow)

- [ ] Implement `AiAttendanceInputInterpreter`
- [ ] Set up AI orchestrator client (urbano vitalino integration)
- [ ] Add feature flag: `ATTENDANCE_AI_INTERPRETER_ENABLED`
- [ ] Switch provider in WhatsApp module:
  ```typescript
  {
    provide: 'AttendanceInputInterpreter',
    useClass: process.env.ATTENDANCE_AI_INTERPRETER_ENABLED
      ? AiAttendanceInputInterpreter
      : RuleBasedAttendanceInputInterpreter,
  }
  ```
- [ ] Test AI fallback behavior
- [ ] Deploy with feature flag off, then gradually enable

---

## Key Benefits

| Benefit | Why It Matters |
|---------|----------------|
| **Predictable v1** | Users see consistent UX; no hallucinations risk |
| **Auditability** | Each state transition logged; compliance friendly |
| **Fast deployment** | Ship rules quickly; rules are simple, testable |
| **Minimal refactor for AI** | Only interpreter changes, not flow/action layer |
| **Easy fallback** | If AI fails or low confidence, automatically use rules |
| **Testable** | Mock interpreters; flow logic independent of AI |
| **Parallel work** | AI team can work on interpreter while flow is shipping |

---

## Common Mistakes to Avoid

❌ **Don't** let AI run the state machine directly  
✅ **Do** keep state machine deterministic; AI only interprets input

❌ **Don't** have flow logic scattered across step handlers  
✅ **Do** centralize transitions in `FlowService`

❌ **Don't** make interpreters return different types per step  
✅ **Do** use same `NormalizedCommand` interface everywhere

❌ **Don't** skip confirmation before writes  
✅ **Do** always show summary + ask explicit confirmation

❌ **Don't** assume AI will always work  
✅ **Do** implement fallback to rules and error handling

❌ **Don't** mix transport layer (WhatsApp) with domain logic  
✅ **Do** keep action handler thin; move logic to services

---

## Monitoring & Observability

### Metrics to Track (v1)

- Completion rate by step (where do users drop off?)
- Error rate per step (which rules are too strict?)
- Time per step (are confirmations taking too long?)
- Cancellation rate

### Metrics to Track (v2 + AI)

- AI confidence distribution (is AI confident?)
- Fallback rate (how often does AI fail?)
- User satisfaction by interpreter (A/B test: AI vs. rules)
- Cost of AI calls

---

## Conclusion

This architecture lets you:

1. **Ship Portal Uvas attendance + service reports safely and quickly** using rule-based input parsing.
2. **Design clean extension points** that make AI integration a plug-in, not a rewrite.
3. **Maintain predictable, auditable business logic** that respects domain constraints (money, attendance).
4. **Test thoroughly** without AI complexity.
5. **Upgrade gradually** with feature flags and monitoring.

When you're ready to add AI (e.g., urbano vitalino integration), you only change the interpreter, not the flow, actions, or domain logic. Everything else stays the same.
