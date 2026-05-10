import { Injectable } from '@nestjs/common';

import { MessagePersistenceService } from '../../service/message-persistence.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';

@Injectable()
export class HelpAction implements ActionHandler {

    public readonly actionKey = 'help';

    public constructor(
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService
    ) {}

    public canHandle(context: ActionContext): boolean {
        const normalized = context.messageText.toLowerCase();
        return normalized === 'ajuda' || normalized === 'help';
    }

    public async handle(context: ActionContext): Promise<ActionResult> {
        const helpText = [
            '🤖 Posso te ajudar com estes comandos:',
            '• menu',
            '• trocar projeto',
            '• ajuda',
            '',
            'Se você estiver escolhendo um projeto, envie o número da opção.',
        ].join('\n');

        const sentMessage = await this.outboundMessenger.sendTextMessage(
            context.contactPayload.wa_id,
            helpText
        );

        await this.messagePersistence.saveOutboundMessage(
            context.conversation.id,
            context.dbContact.id,
            helpText,
            sentMessage?.messages?.[0]?.id
        );

        return {
            handled: true,
            stopProcessing: true,
        };
    }

}
