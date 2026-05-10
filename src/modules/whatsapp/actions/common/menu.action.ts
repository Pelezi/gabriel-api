import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common';
import { MessagePersistenceService } from '../../service/message-persistence.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';

@Injectable()
export class MenuAction implements ActionHandler {

    public readonly actionKey = 'menu';

    public constructor(
        private readonly prisma: PrismaService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService
    ) {}

    public canHandle(context: ActionContext): boolean {
        return context.messageText.toLowerCase() === 'menu';
    }

    public async handle(context: ActionContext): Promise<ActionResult> {
        let activeProjectName = 'Nenhum projeto selecionado';

        if (context.session?.activeProjectId) {
            const project = await this.prisma.project.findUnique({
                where: { id: context.session.activeProjectId },
            });
            activeProjectName = project?.name || activeProjectName;
        }

        const menuText = [
            `📌 Projeto ativo: *${activeProjectName}*`,
            '',
            'Comandos disponíveis:',
            '• ajuda',
            '• menu',
            '• trocar projeto',
        ].join('\n');

        const sentMessage = await this.outboundMessenger.sendTextMessage(
            context.contactPayload.wa_id,
            menuText
        );

        await this.messagePersistence.saveOutboundMessage(
            context.conversation.id,
            context.dbContact.id,
            menuText,
            sentMessage?.messages?.[0]?.id
        );

        return {
            handled: true,
            stopProcessing: true,
        };
    }

}
