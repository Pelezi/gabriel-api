import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common';
import { ConversationSessionService } from '../../service/conversation-session.service';
import { MessagePersistenceService } from '../../service/message-persistence.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { ProjectContextService } from '../../service/project-context.service';
import { ProjectAdapterRegistryService } from '../../integrations';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';

@Injectable()
export class PendingProjectSelectionAction implements ActionHandler {

    public readonly actionKey = 'pending-project-selection';
    private readonly spreadsheetMimeTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.oasis.opendocument.spreadsheet',
    ];

    public constructor(
        private readonly prisma: PrismaService,
        private readonly sessionService: ConversationSessionService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService,
        private readonly projectContextService: ProjectContextService,
        private readonly projectAdapterRegistry: ProjectAdapterRegistryService
    ) {}

    public canHandle(context: ActionContext): boolean {
        return this.sessionService.isAwaitingProjectSelection(context.session) && (!!context.messageText || context.message?.type === 'document');
    }

    private isMagazineDocumentMimeType(mimeType: string | undefined): boolean {
        return mimeType === 'application/pdf' || this.spreadsheetMimeTypes.includes(mimeType || '');
    }

    private async handleUvasMagazineDocument(context: ActionContext): Promise<boolean> {
        const { dbContact, contactPayload, conversation, message } = context;

        if (message?.type !== 'document' || !this.isMagazineDocumentMimeType(message?.document?.mime_type)) {
            return false;
        }

        const uvasProject = await this.prisma.project.findFirst({
            where: { name: { contains: 'uvas', mode: 'insensitive' } },
        });

        if (!uvasProject) {
            return false;
        }

        const checkPhoneData = await this.projectAdapterRegistry.getPhoneCheckData(uvasProject, dbContact.waId);
        const matricesWithPermission = (checkPhoneData.matrices || []).filter((matrix: any) => !!matrix?.canManageMagazines);

        if (!checkPhoneData.exists || matricesWithPermission.length === 0) {
            return false;
        }

        const fileMediaId = message.document.id;
        const fileName = message.document.filename;
        const mimeType = message.document.mime_type;

        if (matricesWithPermission.length === 1) {
            await this.sessionService.setActiveProject(dbContact.id, uvasProject.id);
            await this.sessionService.setAwaitingActionSelection(dbContact.id);
            await this.sessionService.setCurrentActionKey(dbContact.id, 'uvas_landing_magazine_upload_confirm');
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    contextJson: {
                        matrixId: matricesWithPermission[0].id,
                        fileMediaId,
                        fileName,
                        mimeType,
                    },
                },
            });

            const msg = `📎 Você enviou um documento. Detectamos que você tem permissão para enviar revista no projeto Uvas.\n\nDeseja fazer o upload da revista da semana para a matrix *${matricesWithPermission[0].name}*?\nResponda *sim* para confirmar ou *não* para cancelar.`;
            await this.outboundMessenger.sendTextMessage(contactPayload.wa_id, msg);
            await this.messagePersistence.saveOutboundMessage(
                conversation.id,
                dbContact.id,
                msg
            );

            return true;
        }

        await this.sessionService.setActiveProject(dbContact.id, uvasProject.id);
        await this.sessionService.setAwaitingActionSelection(dbContact.id);
        await this.sessionService.setCurrentActionKey(dbContact.id, 'uvas_landing_magazine_select_matrix_pdf');
        await this.prisma.conversationSession.update({
            where: { contactId: dbContact.id },
            data: {
                contextJson: {
                    matrices: matricesWithPermission,
                    fileMediaId,
                    fileName,
                    mimeType,
                },
            },
        });

        let msg = '📎 Você enviou um documento. Detectamos que você tem permissão para enviar revista no projeto Uvas.';
        msg += '\n\nVocê tem permissão em mais de uma matrix. Para qual deseja enviar a revista?\n';
        matricesWithPermission.forEach((matrix: any, index: number) => {
            msg += `${index + 1} - ${matrix.name}\n`;
        });
        msg += '\nResponda com o número da matrix desejada.';

        await this.outboundMessenger.sendTextMessage(contactPayload.wa_id, msg);
        await this.messagePersistence.saveOutboundMessage(
            conversation.id,
            dbContact.id,
            msg
        );

        return true;
    }

    public async handle(context: ActionContext): Promise<ActionResult> {
        const normalized = context.messageText.toLowerCase();

        const handledMagazineDocument = await this.handleUvasMagazineDocument(context);
        if (handledMagazineDocument) {
            return {
                handled: true,
                stopProcessing: true,
            };
        }

        const wantsOwnerChat = normalized === '0'
            || normalized === 'falar com alessandro'
            || normalized === 'falar ocm alessandro'
            || normalized === 'alessandro';

        if (wantsOwnerChat) {
            await this.projectContextService.notifyOwnerForAdminContactRequest();
            await this.sessionService.setChatWithOwner(context.dbContact.id);

            const chatMsg = '📬 Você está em contato direto com Alessandro. Envie sua mensagem e digite *encerrar conversa* quando quiser sair.';
            const sentChatMsg = await this.outboundMessenger.sendTextMessage(context.contactPayload.wa_id, chatMsg);
            await this.messagePersistence.saveOutboundMessage(
                context.conversation.id,
                context.dbContact.id,
                chatMsg,
                sentChatMsg?.messages?.[0]?.id
            );

            return {
                handled: true,
                stopProcessing: true,
            };
        }

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

            const confirmationText = `✅ Projeto selecionado: *${selectedProject?.name}*`;
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

            await this.projectContextService.sendProjectMenu(
                { id: context.dbContact.id, waId: context.contactPayload.wa_id },
                selectedProjectId,
                context.conversation.id
            );

            return {
                handled: true,
                stopProcessing: true,
            };
        }

        const hasProjects = availableIds.length > 0;
        const errorText = hasProjects
            ? '⚠️ Opção inválida. Escolha um projeto listado, *0* para falar com Alessandro, ou digite *cancelar*.'
            : '⚠️ Opção inválida. Digite *0* para falar com Alessandro ou *cancelar* para sair.';
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
