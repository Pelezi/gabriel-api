import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common';
import { ConversationSessionService } from '../../service/conversation-session.service';
import { MessagePersistenceService } from '../../service/message-persistence.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';

@Injectable()
export class PendingProjectSelectionAction implements ActionHandler {

    public readonly actionKey = 'pending-project-selection';

    public constructor(
        private readonly prisma: PrismaService,
        private readonly sessionService: ConversationSessionService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService
    ) {}

    public canHandle(context: ActionContext): boolean {
        return this.sessionService.isAwaitingProjectSelection(context.session) && !!context.messageText;
    }

    public async handle(context: ActionContext): Promise<ActionResult> {
        const normalized = context.messageText.toLowerCase();

        if (normalized === 'cancelar') {
            await this.sessionService.cancelProjectSelection(context.dbContact.id);

            const cancelMsg = '❌ Seleção cancelada. Envie uma mensagem quando precisar.';
            const sentMsg = await this.outboundMessenger.sendTextMessage(context.contactPayload.wa_id, cancelMsg);
            await this.messagePersistence.saveOutboundMessage(
                context.conversation.id,
                context.dbContact.id,
                cancelMsg,
                sentMsg?.messages?.[0]?.id
            );

            return {
                handled: true,
                stopProcessing: true,
            };
        }

        const availableIds = this.sessionService.getAvailableProjectIds(context.session);
        const selectedProjectId = parseInt(context.messageText);

        if (availableIds.includes(selectedProjectId)) {
            await this.sessionService.setActiveProject(context.dbContact.id, selectedProjectId);

            const selectedProject = await this.prisma.project.findUnique({
                where: { id: selectedProjectId },
            });

            const confirmationText = `✅ Perfeito! Agora vamos falar sobre o projeto: *${selectedProject?.name}*. Como posso ajudá-lo?`;
            const sentMessage = await this.outboundMessenger.sendTextMessage(
                context.contactPayload.wa_id,
                confirmationText
            );

            await this.messagePersistence.saveOutboundMessage(
                context.conversation.id,
                context.dbContact.id,
                confirmationText,
                sentMessage?.messages?.[0]?.id
            );

            return {
                handled: true,
                stopProcessing: true,
            };
        }

        const errorText = `⚠️ Opção inválida. Por favor, escolha um dos números listados ou digite *cancelar*.`;
        const sentMessage = await this.outboundMessenger.sendTextMessage(
            context.contactPayload.wa_id,
            errorText
        );

        await this.messagePersistence.saveOutboundMessage(
            context.conversation.id,
            context.dbContact.id,
            errorText,
            sentMessage?.messages?.[0]?.id
        );

        return {
            handled: true,
            stopProcessing: true,
        };
    }

}
