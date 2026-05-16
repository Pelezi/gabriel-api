import { Injectable } from '@nestjs/common';

import { ConversationSessionService } from '../../service/conversation-session.service';
import { MessagePersistenceService } from '../../service/message-persistence.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { ProjectContextService } from '../../service/project-context.service';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';

@Injectable()
export class ChatWithOwnerAction implements ActionHandler {

    public readonly actionKey = 'chat-with-owner';

    public constructor(
        private readonly sessionService: ConversationSessionService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService,
        private readonly projectContextService: ProjectContextService
    ) {}

    public canHandle(context: ActionContext): boolean {
        return this.sessionService.isChatWithOwner(context.session);
    }

    public async handle(context: ActionContext): Promise<ActionResult> {
        const normalized = context.messageText.toLowerCase().trim();

        if (normalized === 'encerrar conversa') {
            await this.sessionService.resetToIdle(context.dbContact.id);

            const closeText = '✅ Conversa encerrada. Voltando ao menu do projeto.';
            const sentClose = await this.outboundMessenger.sendTextMessage(context.contactPayload.wa_id, closeText);
            await this.messagePersistence.saveOutboundMessage(
                context.conversation.id,
                context.dbContact.id,
                closeText,
                sentClose?.messages?.[0]?.id
            );

            if (context.session?.activeProjectId || context.dbContact?.projectId) {
                await this.projectContextService.sendProjectMenu(
                    { id: context.dbContact.id, waId: context.contactPayload.wa_id },
                    context.session?.activeProjectId || context.dbContact?.projectId,
                    context.conversation.id
                );
            }

            return { handled: true, stopProcessing: true };
        }

        return { handled: true, stopProcessing: true };
    }
}
