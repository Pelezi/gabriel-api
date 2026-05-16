import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common';
import { LoggerService } from '../../../common/provider';
import { ConversationSessionService } from '../../service/conversation-session.service';
import { MessagePersistenceService } from '../../service/message-persistence.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { ProjectContextService } from '../../service/project-context.service';
import { ProjectAdapterRegistryService } from '../../integrations';
import { WhatsAppApiHelper } from '../../helpers';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';

@Injectable()
export class ProjectActionSelectionAction implements ActionHandler {

    public readonly actionKey = 'project-action-selection';
    private readonly debugParsing = process.env.DEBUG_ATTENDANCE_PARSING === 'true';
    private readonly whatsappApi: WhatsAppApiHelper;
    private readonly spreadsheetMimeTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.oasis.opendocument.spreadsheet',
    ];

    public constructor(
        private readonly prisma: PrismaService,
        private readonly logger: LoggerService,
        private readonly sessionService: ConversationSessionService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService,
        private readonly projectContextService: ProjectContextService,
        private readonly projectAdapterRegistry: ProjectAdapterRegistryService
    ) {
        this.whatsappApi = new WhatsAppApiHelper();
    }

    public canHandle(context: ActionContext): boolean {
        return (
            this.sessionService.isAwaitingActionSelection(context.session)
            || this.isReportButtonReply(context.messageText)
        );
    }

    private isReportButtonReply(text: string): boolean {
        const n = text.toLowerCase();
        return (
            n === 'preencher relatório da célula'
            || n === 'preencher relatório de presença no culto'
        );
    }

    private isMagazineDocumentMimeType(mimeType: string | undefined): boolean {
        return mimeType === 'application/pdf' || this.spreadsheetMimeTypes.includes(mimeType || '');
    }

    public async handle(context: ActionContext): Promise<ActionResult> {

        const { dbContact, contactPayload, conversation, session, messageText, message } = context;
        const normalized = messageText.toLowerCase().trim();

        // --- NOVO FLUXO: documento enviado sem projeto/ação selecionada ---
        if (!session?.activeProjectId && message?.type === 'document' && this.isMagazineDocumentMimeType(message?.document?.mime_type)) {
            // Buscar projeto Uvas
            const uvasProject = await this.prisma.project.findFirst({
                where: { name: { contains: 'uvas', mode: 'insensitive' } },
            });
            if (uvasProject) {
                // Verificar se usuário está cadastrado e tem permissão de magazine
                const checkPhoneData = await this.projectAdapterRegistry.getPhoneCheckData(uvasProject, dbContact.waId);
                const matricesWithPermission = (checkPhoneData.matrices || []).filter((m: any) => !!m?.canManageMagazines);
                if (checkPhoneData.exists && matricesWithPermission.length > 0) {
                    // Perguntar se deseja fazer upload e de qual matrix (se mais de uma)
                    let msg = '📎 Você enviou um documento. Detectamos que você tem permissão para enviar revista no projeto Uvas.';
                    const prisma = this.prisma;
                    if (matricesWithPermission.length === 1) {
                        msg += `\n\nDeseja fazer o upload da revista da semana para a matrix *${matricesWithPermission[0].name}*?\nResponda *sim* para confirmar ou *não* para cancelar.`;
                        // Salvar contexto para próxima resposta
                        await this.sessionService.setCurrentActionKey(dbContact.id, 'uvas_landing_magazine_upload_confirm');
                        await prisma.conversationSession.update({
                            where: { contactId: dbContact.id },
                            data: {
                                contextJson: {
                                    matrixId: matricesWithPermission[0].id,
                                    fileMediaId: message.document.id,
                                    fileName: message.document.filename,
                                    mimeType: message.document.mime_type,
                                },
                            },
                        });
                    } else {
                        msg += '\n\nVocê tem permissão em mais de uma matrix. Para qual deseja enviar a revista?\n';
                        matricesWithPermission.forEach((m: any, i: number) => {
                            msg += `${i + 1} - ${m.name}\n`;
                        });
                        msg += '\nResponda com o número da matrix desejada.';
                        await this.sessionService.setCurrentActionKey(dbContact.id, 'uvas_landing_magazine_select_matrix_pdf');
                        await prisma.conversationSession.update({
                            where: { contactId: dbContact.id },
                            data: {
                                contextJson: {
                                    matrices: matricesWithPermission,
                                    fileMediaId: message.document.id,
                                    fileName: message.document.filename,
                                    mimeType: message.document.mime_type,
                                },
                            },
                        });
                    }
                    await this.sendAndSave(contactPayload.wa_id, msg, conversation.id, dbContact.id);
                    return { handled: true, stopProcessing: true };
                }
            }
            // Se não está cadastrado ou não tem permissão, segue fluxo normal (menu padrão)
        }

        // --- NOVO FLUXO: documento enviado na seleção de ação do projeto Uvas ---
        if (
            session?.activeProjectId &&
            message?.type === 'document' &&
            this.isMagazineDocumentMimeType(message?.document?.mime_type)
        ) {
            const project = await this.prisma.project.findUnique({ where: { id: session.activeProjectId } });
            if (project && project.name.toLowerCase().includes('uvas')) {
                const checkPhoneData = await this.projectAdapterRegistry.getPhoneCheckData(project, dbContact.waId);
                const matricesWithPermission = (checkPhoneData.matrices || []).filter((m: any) => !!m?.canManageMagazines);
                if (checkPhoneData.exists && matricesWithPermission.length > 0) {
                    let msg = '📎 Você enviou um documento. Detectamos que você tem permissão para enviar revista no projeto Uvas.';
                    const prisma = this.prisma;
                    if (matricesWithPermission.length === 1) {
                        msg += `\n\nDeseja fazer o upload da revista da semana para a matrix *${matricesWithPermission[0].name}*?\nResponda *sim* para confirmar ou *não* para cancelar.`;
                        await this.sessionService.setCurrentActionKey(dbContact.id, 'uvas_landing_magazine_upload_confirm');
                        await prisma.conversationSession.update({
                            where: { contactId: dbContact.id },
                            data: {
                                contextJson: {
                                    matrixId: matricesWithPermission[0].id,
                                    fileMediaId: message.document.id,
                                    fileName: message.document.filename,
                                    mimeType: message.document.mime_type,
                                },
                            },
                        });
                    } else {
                        msg += '\n\nVocê tem permissão em mais de uma matrix. Para qual deseja enviar a revista?\n';
                        matricesWithPermission.forEach((m: any, i: number) => {
                            msg += `${i + 1} - ${m.name}\n`;
                        });
                        msg += '\nResponda com o número da matrix desejada.';
                        await this.sessionService.setCurrentActionKey(dbContact.id, 'uvas_landing_magazine_select_matrix_pdf');
                        await prisma.conversationSession.update({
                            where: { contactId: dbContact.id },
                            data: {
                                contextJson: {
                                    matrices: matricesWithPermission,
                                    fileMediaId: message.document.id,
                                    fileName: message.document.filename,
                                    mimeType: message.document.mime_type,
                                },
                            },
                        });
                    }
                    await this.sendAndSave(contactPayload.wa_id, msg, conversation.id, dbContact.id);
                    return { handled: true, stopProcessing: true };
                }
            }
            // Se não está cadastrado ou não tem permissão, segue fluxo normal (menu padrão)
        }

        // Direct button reply from a report reminder template — bypass menu state
        if (this.isReportButtonReply(normalized)) {
            return this.handleDirectReportButtonReply(normalized, dbContact, contactPayload.wa_id, conversation);
        }

        // Cancel out of any action-selection sub-state
        if (normalized === 'cancelar') {
            await this.finishFlowWithProjectMenu(
                dbContact,
                contactPayload.wa_id,
                conversation,
                '❌ Ação cancelada.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }

        // Sub-state: report cell selection (if multiple cells)
        if (session?.currentActionKey === 'uvas_report_select_cell') {
            return this.handleReportCellSelection(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        // Sub-state: report type selection (culto or célula)
        if (session?.currentActionKey === 'uvas_report_select_type') {
            return this.handleReportTypeSelection(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_select_date') {
            return this.handleReportDateSelection(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_existing_edit_confirm') {
            return this.handleExistingReportEditConfirmation(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_attendance_input') {
            return this.handleAttendanceInput(messageText, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_attendance_confirm') {
            return this.handleAttendanceConfirmation(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_celula_visitantes') {
            return this.handleCelulaVisitantesInput(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_celula_oferta') {
            return this.handleCelulaOfertaInput(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_celula_entrega') {
            return this.handleCelulaEntregaInput(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_celula_resumo') {
            return this.handleCelulaResumoInput(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_celula_enviar') {
            return this.handleCelulaEnvio(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_edit_celula_visitantes_confirm') {
            return this.handleCelulaEditVisitantesConfirm(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_edit_celula_visitantes_input') {
            return this.handleCelulaEditVisitantesInput(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_edit_celula_oferta_confirm') {
            return this.handleCelulaEditOfertaConfirm(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_edit_celula_oferta_input') {
            return this.handleCelulaEditOfertaInput(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_report_edit_celula_entrega_input') {
            return this.handleCelulaEditEntregaInput(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_landing_select_matrix') {
            return this.handleLandingSelectMatrix(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_landing_page_menu') {
            return this.handleLandingPageMenuSelection(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_landing_magazine_select_week') {
            return this.handleLandingMagazineWeekSelection(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_landing_magazine_replace_confirm') {
            return this.handleLandingMagazineReplaceConfirmation(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_landing_magazine_waiting_file') {
            return this.handleLandingMagazineFileInput(message, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_landing_announcement_menu') {
            return this.handleLandingAnnouncementMenuSelection(normalized, dbContact, contactPayload.wa_id, conversation, session);
        }

        if (session?.currentActionKey === 'uvas_landing_magazine_select_matrix_pdf') {
            return this.handleLandingMagazineSelectMatrixPdf(normalized, dbContact, contactPayload.wa_id, conversation, session, message);
        }

        if (session?.currentActionKey === 'uvas_landing_magazine_upload_confirm') {
            return this.handleLandingMagazineUploadConfirm(normalized, dbContact, contactPayload.wa_id, conversation, session, message);
        }

        // Top-level action selection
        const project = session?.activeProjectId
            ? await this.prisma.project.findUnique({ where: { id: session.activeProjectId } })
            : null;

        if (!project) {
            await this.sessionService.resetToIdle(dbContact.id);
            return { handled: false, stopProcessing: false };
        }

        const actions = await this.projectAdapterRegistry.listAvailableActionsForContact(project, dbContact.waId);
        const idx = parseInt(normalized, 10);

        if (!isNaN(idx) && idx >= 1 && idx <= actions.length) {
            return this.dispatchAction(actions[idx - 1].actionKey, dbContact, contactPayload, conversation, project);
        }

        // Label match (e.g. user types the full action name)
        const byLabel = actions.find((a) => a.label.toLowerCase() === normalized);
        if (byLabel) {
            return this.dispatchAction(byLabel.actionKey, dbContact, contactPayload, conversation, project);
        }

        // Invalid selection — re-show menu
        let menuText = '⚠️ Opção inválida. Escolha uma das opções:\n\n';
        actions.forEach((a, i) => {
            menuText += `${i + 1} - ${a.label}\n`;
        });
        menuText += '\n❌ Digite *cancelar* para voltar.';

        await this.sendAndSave(contactPayload.wa_id, menuText, conversation.id, dbContact.id);
        return { handled: true, stopProcessing: true };
    }

    private async handleLandingMagazineSelectMatrixPdf(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any,
        message: any
    ): Promise<ActionResult> {
        try {
            const matrices: Array<{ id: number; name: string; canManageMagazines: boolean; canManageAnnouncements: boolean }> = Array.isArray(session?.contextJson?.matrices) ? session.contextJson.matrices : [];
            const fileMediaId = session?.contextJson?.fileMediaId;
            const fileName = session?.contextJson?.fileName;
            const mimeType = session?.contextJson?.mimeType;

            if (!matrices.length || !fileMediaId) {
                await this.sendAndSave(
                    waId,
                    '❌ Ocorreu um erro ao processar sua seleção. Tente enviar o arquivo novamente.',
                    conversation.id,
                    dbContact.id
                );
                await this.sessionService.resetToIdle(dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            const idx = parseInt(normalized, 10);
            const selected = !isNaN(idx) && idx >= 1 && idx <= matrices.length
                ? matrices[idx - 1]
                : matrices.find((m: any) => m.name.toLowerCase() === normalized);

            if (!selected) {
                let text = '⚠️ Opção inválida. Escolha a matrix:\n\n';
                matrices.forEach((matrix: any, index: number) => {
                    text += `${index + 1} - ${matrix.name}\n`;
                });
                text += '\n❌ Digite *cancelar* para voltar.';
                await this.sendAndSave(waId, text, conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            this.logger.info(`[LandingMagazineSelectMatrixPdf] Usuário selecionou matrix: ${selected.name} (ID: ${selected.id})`);

            // Buscar projeto Uvas
            const uvasProject = await this.prisma.project.findFirst({
                where: { name: { contains: 'uvas', mode: 'insensitive' } },
            });

            if (!uvasProject) {
                await this.sendAndSave(
                    waId,
                    '❌ Não consegui localizar o projeto Uvas.',
                    conversation.id,
                    dbContact.id
                );
                await this.sessionService.resetToIdle(dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            // Buscar status de magazines para essa matrix específica
            const status = await this.projectAdapterRegistry.getLandingMagazineStatus(uvasProject, dbContact.waId, selected.id);
            const weeks = Array.isArray(status?.weeks) ? status.weeks : [];

            if (!weeks.length) {
                await this.sendAndSave(
                    waId,
                    '📚 Não encontrei semanas recentes para exibir o status das revistas.',
                    conversation.id,
                    dbContact.id
                );
                await this.sessionService.resetToIdle(dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            // Atualizar session com projeto ativo, matrix selecionada e semanas
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    activeProjectId: uvasProject.id,
                    currentActionKey: 'uvas_landing_magazine_select_week',
                    contextJson: {
                        selectedMatrixId: selected.id,
                        fileMediaId,
                        fileName,
                        mimeType,
                        magazineWeeks: weeks,
                    } as any,
                },
            });

            this.logger.info(`[LandingMagazineSelectMatrixPdf] Sessão atualizada. Matrix: ${selected.id}, Semanas disponíveis: ${weeks.length}`);

            // Pular direto para seleção de semana (já sabemos que é revista)
            await this.sendAndSave(waId, this.buildLandingMagazineWeeksMenuText(weeks), conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error: any) {
            this.logger.error(`Erro ao selecionar matrix para PDF: ${error}`, error?.stack);
            await this.sendAndSave(
                waId,
                '❌ Erro ao processar sua seleção. Tente novamente.',
                conversation.id,
                dbContact.id
            );
            await this.sessionService.resetToIdle(dbContact.id);
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleLandingMagazineUploadConfirm(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any,
        message: any
    ): Promise<ActionResult> {
        try {
            const fileMediaId = session?.contextJson?.fileMediaId;
            const fileName = session?.contextJson?.fileName;
            const mimeType = session?.contextJson?.mimeType;
            const matrixId = session?.contextJson?.matrixId;

            if (!fileMediaId || !mimeType) {
                await this.sendAndSave(
                    waId,
                    '❌ Ocorreu um erro ao processar sua solicitação. Tente enviar o arquivo novamente.',
                    conversation.id,
                    dbContact.id
                );
                await this.sessionService.resetToIdle(dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            const response = normalized.toLowerCase().trim();
            const isConfirming = response === 'sim' || response === 'yes' || response === 's' || response === 'y';

            if (!isConfirming && (response !== 'não' && response !== 'no' && response !== 'n')) {
                await this.sendAndSave(
                    waId,
                    '⚠️ Responda com *sim* ou *não*.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            if (!isConfirming) {
                await this.sendAndSave(
                    waId,
                    '❌ Upload cancelado. Você pode enviar outro arquivo ou voltar ao menu.',
                    conversation.id,
                    dbContact.id
                );
                await this.sessionService.resetToIdle(dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            this.logger.info(`[LandingMagazineUploadConfirm] Usuário confirmou upload do arquivo: ${fileName}`);

            // Buscar projeto Uvas
            const uvasProject = await this.prisma.project.findFirst({
                where: { name: { contains: 'uvas', mode: 'insensitive' } },
            });

            if (!uvasProject) {
                await this.sendAndSave(
                    waId,
                    '❌ Não consegui localizar o projeto Uvas.',
                    conversation.id,
                    dbContact.id
                );
                await this.sessionService.resetToIdle(dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            // Buscar status de magazines para essa matrix específica
            const status = await this.projectAdapterRegistry.getLandingMagazineStatus(uvasProject, dbContact.waId, matrixId);
            const weeks = Array.isArray(status?.weeks) ? status.weeks : [];

            if (!weeks.length) {
                await this.sendAndSave(
                    waId,
                    '📚 Não encontrei semanas recentes para exibir o status das revistas.',
                    conversation.id,
                    dbContact.id
                );
                await this.sessionService.resetToIdle(dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            // Atualizar session com as semanas disponíveis
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    activeProjectId: uvasProject.id,
                    currentActionKey: 'uvas_landing_magazine_select_week',
                    contextJson: {
                        selectedMatrixId: matrixId,
                        fileMediaId,
                        fileName,
                        mimeType,
                        magazineWeeks: weeks,
                    } as any,
                },
            });

            this.logger.info(`[LandingMagazineUploadConfirm] Sessão atualizada com semanas. Matrix: ${matrixId}`);

            // Pular direto para seleção de semana
            await this.sendAndSave(waId, this.buildLandingMagazineWeeksMenuText(weeks), conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error: any) {
            this.logger.error(`Erro ao processar confirmação de upload: ${error}`, error?.stack);
            await this.sendAndSave(
                waId,
                '❌ Erro ao processar seu upload. Tente novamente.',
                conversation.id,
                dbContact.id
            );
            await this.sessionService.resetToIdle(dbContact.id);
            return { handled: true, stopProcessing: true };
        }
    }

    private async dispatchAction(
        actionKey: string,
        dbContact: any,
        contactPayload: any,
        conversation: any,
        project: any
    ): Promise<ActionResult> {
        switch (actionKey) {
            case 'uvas_fill_report':
                return this.handleUvasFillReport(dbContact, contactPayload.wa_id, conversation, project);

            case 'uvas_landing_page':
                return this.handleUvasLandingPage(dbContact, contactPayload.wa_id, conversation, project);

            case 'uvas_contact_admin':
                await this.projectContextService.notifyOwnerForAdminContactRequest();
                await this.sessionService.setChatWithOwner(dbContact.id);
                await this.sendAndSave(
                    contactPayload.wa_id,
                    '📬 Você está em contato direto com Alessandro. Envie suas mensagens normalmente e digite *encerrar conversa* quando quiser sair.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };

            case 'talentos_new_transaction':
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    contactPayload.wa_id,
                    conversation,
                    '💸 Funcionalidade de criação de transação em desenvolvimento!',
                    project?.id
                );
                return { handled: true, stopProcessing: true };

            default:
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    contactPayload.wa_id,
                    conversation,
                    '⚙️ Ação em desenvolvimento. Em breve disponível!',
                    project?.id
                );
                return { handled: true, stopProcessing: true };
        }
    }

    private async handleUvasLandingPage(
        dbContact: any,
        waId: string,
        conversation: any,
        project: any
    ): Promise<ActionResult> {
        try {
            const checkPhoneData = await this.projectAdapterRegistry.getPhoneCheckData(project, dbContact.waId);
            const matricesWithPermission = (checkPhoneData.matrices || []).filter((m: any) => {
                return !!m?.canManageMagazines || !!m?.canManageAnnouncements;
            });

            console.log('[LandingPage][MatrixDecision]', {
                contactId: dbContact?.id,
                waId: dbContact?.waId,
                projectId: project?.id,
                projectName: project?.name,
                exists: checkPhoneData?.exists,
                matrixCount: matricesWithPermission.length,
                matrices: matricesWithPermission,
            });

            if (!checkPhoneData?.exists || matricesWithPermission.length === 0) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Você não possui permissão para gerenciar a landing page.',
                    project?.id
                );
                return { handled: true, stopProcessing: true };
            }
            if (matricesWithPermission.length > 1) {
                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_landing_select_matrix',
                        contextJson: {
                            matrices: matricesWithPermission,
                        } as any,
                    },
                });
                let matrixSelectText = '*Landing page*\n\nVocê faz parte de mais de uma matrix. Escolha em qual deseja consultar:\n\n';
                matricesWithPermission.forEach((matrix: any, index: number) => {
                    matrixSelectText += `${index + 1} - ${matrix.name}\n`;
                });
                matrixSelectText += '\n❌ Digite *cancelar* para voltar.';
                await this.sendAndSave(waId, matrixSelectText, conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            // Single matrix — auto-select
            const selectedMatrix = matricesWithPermission[0];
            const options: Array<{ key: 'magazines' | 'announcements'; label: string }> = [];
            if (selectedMatrix?.canManageMagazines) {
                options.push({ key: 'magazines', label: 'Enviar revista' });
            }
            if (selectedMatrix?.canManageAnnouncements) {
                options.push({ key: 'announcements', label: 'Enviar aviso' });
            }

            if (!options.length) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Você não possui permissão para gerenciar a landing page.',
                    project?.id
                );
                return { handled: true, stopProcessing: true };
            }

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_landing_page_menu',
                    contextJson: {
                        landingOptions: options,
                        selectedMatrixId: selectedMatrix.id,
                    } as any,
                },
            });
            let landingMenuText = '*Landing page*\n\nEscolha uma opção:\n';
            options.forEach((option, index) => {
                landingMenuText += `${index + 1} - ${option.label}\n`;
            });
            landingMenuText += '\n❌ Digite *cancelar* para voltar.';
            await this.sendAndSave(waId, landingMenuText, conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling Uvas landing page:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao abrir o menu da landing page.',
                project?.id
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleLandingSelectMatrix(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const matrices: Array<{ id: number; name: string; canManageMagazines: boolean; canManageAnnouncements: boolean }> = Array.isArray(session?.contextJson?.matrices) ? session.contextJson.matrices : [];

            console.log('[LandingPage][MatrixDecision][UserInputReceived]', {
                contactId: dbContact?.id,
                waId: dbContact?.waId,
                activeProjectId: session?.activeProjectId,
                rawInput: normalized,
                matrixCount: matrices.length,
                matrices,
            });

            if (!matrices.length) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Não consegui carregar suas opções de landing page.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const idx = parseInt(normalized, 10);
            const selected = !isNaN(idx) && idx >= 1 && idx <= matrices.length
                ? matrices[idx - 1]
                : matrices.find((m: any) => m.name.toLowerCase() === normalized);

            if (!selected) {
                console.log('[LandingPage][MatrixDecision][InvalidSelection]', {
                    contactId: dbContact?.id,
                    waId: dbContact?.waId,
                    activeProjectId: session?.activeProjectId,
                    rawInput: normalized,
                    expectedIndexes: matrices.map((_, index) => index + 1),
                    expectedNames: matrices.map((m) => m.name),
                });

                let text = '⚠️ Opção inválida. Escolha a matrix:\n\n';
                matrices.forEach((matrix: any, index: number) => {
                    text += `${index + 1} - ${matrix.name}\n`;
                });
                text += '\n❌ Digite *cancelar* para voltar.';
                await this.sendAndSave(waId, text, conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            console.log('[LandingPage][MatrixDecision][UserSelected]', {
                contactId: dbContact?.id,
                waId: dbContact?.waId,
                activeProjectId: session?.activeProjectId,
                rawInput: normalized,
                selectedMatrixId: selected.id,
                selectedMatrixName: selected.name,
                selectedPermissions: {
                    canManageMagazines: !!selected?.canManageMagazines,
                    canManageAnnouncements: !!selected?.canManageAnnouncements,
                },
            });

            const options: Array<{ key: 'magazines' | 'announcements'; label: string }> = [];
            if (selected?.canManageMagazines) {
                options.push({ key: 'magazines', label: 'Enviar revista' });
            }
            if (selected?.canManageAnnouncements) {
                options.push({ key: 'announcements', label: 'Enviar aviso' });
            }

            if (!options.length) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Você não possui permissão para gerenciar a landing page nessa matrix.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_landing_page_menu',
                    contextJson: {
                        landingOptions: options,
                        selectedMatrixId: selected.id,
                    } as any,
                },
            });

            let text = `*Landing page — ${selected.name}*\n\nEscolha uma opção:\n`;
            options.forEach((option: any, index: number) => {
                text += `${index + 1} - ${option.label}\n`;
            });
            text += '\n❌ Digite *cancelar* para voltar.';

            await this.sendAndSave(waId, text, conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling landing matrix selection:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao selecionar a matrix.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleLandingPageMenuSelection(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });
            const options = Array.isArray(session?.contextJson?.landingOptions) ? session.contextJson.landingOptions : [];

            if (!project || !options.length) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Não consegui carregar suas opções de landing page.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const idx = parseInt(normalized, 10);
            const selected = !isNaN(idx) && idx >= 1 && idx <= options.length
                ? options[idx - 1]
                : options.find((option: any) => option.label.toLowerCase() === normalized);

            if (!selected) {
                let text = '⚠️ Opção inválida. Escolha uma das opções:\n\n';
                options.forEach((option: any, index: number) => {
                    text += `${index + 1} - ${option.label}\n`;
                });
                text += '\n❌ Digite *cancelar* para voltar.';
                await this.sendAndSave(waId, text, conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            if (selected.key === 'magazines') {
                const matrixId = session?.contextJson?.selectedMatrixId ?? undefined;
                console.log('[LandingPage][MatrixDecision][UsingMatrixForMagazines]', {
                    contactId: dbContact?.id,
                    waId: dbContact?.waId,
                    activeProjectId: session?.activeProjectId,
                    selectedMatrixId: matrixId ?? null,
                });
                const status = await this.projectAdapterRegistry.getLandingMagazineStatus(project, dbContact.waId, matrixId);
                const weeks = Array.isArray(status?.weeks) ? status.weeks : [];

                if (!weeks.length) {
                    await this.finishFlowWithProjectMenu(
                        dbContact,
                        waId,
                        conversation,
                        '📚 Não encontrei semanas recentes para exibir o status das revistas.',
                        session?.activeProjectId
                    );
                    return { handled: true, stopProcessing: true };
                }

                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_landing_magazine_select_week',
                        contextJson: {
                            selectedMatrixId: matrixId ?? null,
                            landingOptions: options,
                            magazineWeeks: weeks,
                        } as any,
                    },
                });

                await this.sendAndSave(
                    waId,
                    this.buildLandingMagazineWeeksMenuText(weeks),
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            const matrixId = session?.contextJson?.selectedMatrixId ?? undefined;
            console.log('[LandingPage][MatrixDecision][UsingMatrixForAnnouncements]', {
                contactId: dbContact?.id,
                waId: dbContact?.waId,
                activeProjectId: session?.activeProjectId,
                selectedMatrixId: matrixId ?? null,
            });
            const announcements = await this.projectAdapterRegistry.getActiveLandingAnnouncements(project, dbContact.waId, matrixId);

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_landing_announcement_menu',
                    contextJson: {
                        announcements,
                    } as any,
                },
            });

            let text = '*Avisos ativos*\n\n1 - Enviar novo aviso\n';
            announcements.forEach((announcement: any, index: number) => {
                text += `${index + 2} - Editar aviso: ${announcement.title || `#${announcement.id}`}\n`;
            });
            text += '\n❌ Digite *cancelar* para voltar.';

            await this.sendAndSave(waId, text, conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling landing page menu selection:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar opção da landing page.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleLandingMagazineWeekSelection(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const weeks = Array.isArray(session?.contextJson?.magazineWeeks) ? session.contextJson.magazineWeeks : [];
            const idx = parseInt(normalized, 10);
            const selectedWeek = !isNaN(idx) && idx >= 1 && idx <= weeks.length ? weeks[idx - 1] : null;

            if (!selectedWeek) {
                await this.sendAndSave(
                    waId,
                    `⚠️ Opção inválida.\n\n${this.buildLandingMagazineWeeksMenuText(weeks)}`,
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            if (selectedWeek?.hasMagazine) {
                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_landing_magazine_replace_confirm',
                        contextJson: {
                            ...session?.contextJson,
                            selectedMagazineWeek: selectedWeek,
                        } as any,
                    },
                });

                await this.sendAndSave(
                    waId,
                    `⚠️ Já existe uma revista enviada para a semana *${this.formatWeekPeriodLabel(selectedWeek)}*.\n\nDeseja substituir? Responda *sim* ou *não*.`,
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            await this.startLandingMagazineFileUpload(dbContact.id, waId, conversation.id, dbContact.id, session, selectedWeek, false);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling landing magazine week selection:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao selecionar a semana da revista.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleLandingMagazineReplaceConfirmation(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        const isYes = normalized === 'sim' || normalized === 'yes' || normalized === 's';
        const isNo = normalized === 'não' || normalized === 'nao' || normalized === 'n' || normalized === 'no';
        const selectedWeek = session?.contextJson?.selectedMagazineWeek;
        const weeks = Array.isArray(session?.contextJson?.magazineWeeks) ? session.contextJson.magazineWeeks : [];

        if (isYes) {
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    contextJson: {
                        ...session?.contextJson,
                        selectedMagazineWeek: selectedWeek,
                        replaceExistingMagazine: true,
                    } as any,
                },
            });

            await this.startLandingMagazineFileUpload(dbContact.id, waId, conversation.id, dbContact.id, session, selectedWeek, true);
            return { handled: true, stopProcessing: true };
        }

        if (isNo) {
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_landing_magazine_select_week',
                    contextJson: {
                        ...session?.contextJson,
                        selectedMagazineWeek: null,
                    } as any,
                },
            });

            await this.sendAndSave(waId, this.buildLandingMagazineWeeksMenuText(weeks), conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        }

        await this.sendAndSave(
            waId,
            '⚠️ Responda com *sim* para substituir ou *não* para escolher outra semana.',
            conversation.id,
            dbContact.id
        );
        return { handled: true, stopProcessing: true };
    }

    private async handleLandingMagazineFileInput(
        message: any,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });
            const selectedWeek = session?.contextJson?.selectedMagazineWeek;
            const matrixId = session?.contextJson?.selectedMatrixId ?? undefined;
            const replaceExisting = !!session?.contextJson?.replaceExistingMagazine;

            if (!project || !selectedWeek?.isoDate) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Não consegui recuperar os dados da semana para envio da revista.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            if (message?.type !== 'document') {
                await this.sendAndSave(
                    waId,
                    `📎 Envie um arquivo *PDF* para a semana *${this.formatWeekPeriodLabel(selectedWeek)}*.`,
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            const mimeType = message?.document?.mime_type;
            if (mimeType !== 'application/pdf') {
                await this.sendAndSave(
                    waId,
                    '⚠️ O arquivo precisa ser um *PDF*. Envie novamente o documento correto.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }


            const mediaId = message?.document?.id;
            if (!mediaId) {
                await this.sendAndSave(
                    waId,
                    '❌ Não consegui identificar o arquivo enviado. Tente novamente com um PDF.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            // Send confirmation message before processing/upload
            await this.sendAndSave(
                waId,
                '✅ Arquivo recebido! Estamos processando sua revista. Você receberá uma confirmação em instantes.',
                conversation.id,
                dbContact.id
            );

            const fileBuffer = await this.whatsappApi.downloadMedia(mediaId);
            const fileName = message?.document?.filename || `revista-${selectedWeek.isoDate}.pdf`;

            const uploadResult = await this.projectAdapterRegistry.uploadLandingMagazine(project, dbContact.waId, {
                weekStartDate: selectedWeek.isoDate,
                fileBuffer,
                fileName,
                mimeType,
                matrixId,
                replaceExisting,
            });

            if (!uploadResult.success && uploadResult.statusCode === 409 && !replaceExisting) {
                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_landing_magazine_replace_confirm',
                        contextJson: {
                            ...session?.contextJson,
                            selectedMagazineWeek: selectedWeek,
                        } as any,
                    },
                });

                await this.sendAndSave(
                    waId,
                    `⚠️ Já existe uma revista enviada para a semana *${this.formatWeekPeriodLabel(selectedWeek)}*.\n\nDeseja substituir? Responda *sim* ou *não*.`,
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            if (!uploadResult.success) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    `❌ ${uploadResult.message || 'Erro ao enviar revista.'}\n\nRetornando ao menu de ações do projeto.`,
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const successMessage = replaceExisting
                ? `✅ Revista da semana *${this.formatWeekPeriodLabel(selectedWeek)}* substituída com sucesso.`
                : `✅ Revista da semana *${this.formatWeekPeriodLabel(selectedWeek)}* enviada com sucesso.`;

            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                successMessage,
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling landing magazine file input:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar o arquivo da revista.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async startLandingMagazineFileUpload(
        sessionContactId: string,
        waId: string,
        conversationId: string,
        contactId: string,
        session: any,
        selectedWeek: any,
        replaceExisting: boolean
    ): Promise<void> {
        const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });
        const fileMediaId = session?.contextJson?.fileMediaId;
        const fileName = session?.contextJson?.fileName;
        const mimeType = session?.contextJson?.mimeType;
        const matrixId = session?.contextJson?.selectedMatrixId ?? undefined;

        if (!project || !selectedWeek?.isoDate || !fileMediaId || !mimeType) {
            await this.finishFlowWithProjectMenu(
                { id: contactId },
                waId,
                { id: conversationId },
                '❌ Não consegui recuperar os dados do arquivo ou da semana para envio da revista.',
                session?.activeProjectId
            );
            return;
        }

        await this.prisma.conversationSession.update({
            where: { contactId: sessionContactId },
            data: {
                contextJson: {
                    ...session?.contextJson,
                    selectedMagazineWeek: selectedWeek,
                    replaceExistingMagazine: replaceExisting,
                } as any,
            },
        });

        await this.sendAndSave(
            waId,
            '✅ Arquivo recebido! Estamos processando sua revista. Você receberá uma confirmação em instantes.',
            conversationId,
            contactId
        );

        const fileBuffer = await this.whatsappApi.downloadMedia(fileMediaId);
        const resolvedFileName = fileName || `revista-${selectedWeek.isoDate}.pdf`;

        const uploadResult = await this.projectAdapterRegistry.uploadLandingMagazine(project, waId, {
            weekStartDate: selectedWeek.isoDate,
            fileBuffer,
            fileName: resolvedFileName,
            mimeType,
            matrixId,
            replaceExisting,
        });

        if (!uploadResult.success && uploadResult.statusCode === 409 && !replaceExisting) {
            await this.prisma.conversationSession.update({
                where: { contactId: sessionContactId },
                data: {
                    currentActionKey: 'uvas_landing_magazine_replace_confirm',
                    contextJson: {
                        ...session?.contextJson,
                        selectedMagazineWeek: selectedWeek,
                    } as any,
                },
            });

            await this.sendAndSave(
                waId,
                `⚠️ Já existe uma revista enviada para a semana *${this.formatWeekPeriodLabel(selectedWeek)}*.
\nDeseja substituir? Responda *sim* ou *não*.`,
                conversationId,
                contactId
            );
            return;
        }

        if (!uploadResult.success) {
            await this.finishFlowWithProjectMenu(
                { id: contactId },
                waId,
                { id: conversationId },
                `❌ ${uploadResult.message || 'Erro ao enviar revista.'}\n\nRetornando ao menu de ações do projeto.`,
                session?.activeProjectId
            );
            return;
        }

        const successMessage = replaceExisting
            ? `✅ Revista da semana *${this.formatWeekPeriodLabel(selectedWeek)}* substituída com sucesso.`
            : `✅ Revista da semana *${this.formatWeekPeriodLabel(selectedWeek)}* enviada com sucesso.`;

        await this.finishFlowWithProjectMenu(
            { id: contactId },
            waId,
            { id: conversationId },
            successMessage,
            session?.activeProjectId
        );
    }

    private buildLandingMagazineWeeksMenuText(weeks: any[]): string {
        let text = '*Revistas - últimas semanas*\n\nSelecione a semana que deseja usar para o PDF já enviado:\n\n';
        weeks.forEach((week: any, index: number) => {
            const label = this.formatWeekPeriodLabel(week);
            const statusLabel = week?.hasMagazine ? '✅ Enviada' : '⏳ Pendente';
            text += `${index + 1} - ${label}: ${statusLabel}\n`;
        });
        text += '\nDepois de escolher a semana, o sistema usará o PDF que você já enviou.\n';
        text += '\n❌ Digite *cancelar* para voltar.';
        return text;
    }

    private async handleLandingAnnouncementMenuSelection(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const announcements = Array.isArray(session?.contextJson?.announcements) ? session.contextJson.announcements : [];
            const idx = parseInt(normalized, 10);

            if (!isNaN(idx) && idx === 1) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '📣 Para enviar um novo aviso com imagens, utilize a área administrativa da landing page.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            if (!isNaN(idx) && idx >= 2 && idx <= announcements.length + 1) {
                const selected = announcements[idx - 2];
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    `✏️ Para editar o aviso *${selected?.title || `#${selected?.id}`}*, utilize a área administrativa da landing page.`,
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            let text = '⚠️ Opção inválida. Escolha uma das opções:\n\n1 - Enviar novo aviso\n';
            announcements.forEach((announcement: any, index: number) => {
                text += `${index + 2} - Editar aviso: ${announcement.title || `#${announcement.id}`}\n`;
            });
            text += '\n❌ Digite *cancelar* para voltar.';

            await this.sendAndSave(waId, text, conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling landing announcement menu selection:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar submenu de avisos.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    // ---------- Uvas Fill Report Flow ----------------------------------------

    private async handleUvasFillReport(
        dbContact: any,
        waId: string,
        conversation: any,
        project: any
    ): Promise<ActionResult> {
        try {
            // Fetch cells where user is leader
            const leaderData = await this.projectAdapterRegistry.getLeaderCells(project, dbContact.waId);
            const cells = leaderData.cells;

            if (!cells || cells.length === 0) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Você não é líder ou líder em treinamento de nenhuma célula.',
                    project?.id
                );
                return { handled: true, stopProcessing: true };
            }

            // Store cells in context
            const contextJson = { cells } as any;

            if (cells.length === 1) {
                // Single cell: ask about report type directly
                contextJson.selectedCellId = cells[0].id;
                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_report_select_type',
                        contextJson: contextJson as any,
                    },
                });

                const cellName = cells[0].name || `Célula #${cells[0].id}`;
                const menuText = [
                    `✅ Você pode preencher o relatório da célula: *${cellName}*`,
                    '',
                    '*Qual relatório você gostaria de preencher?*',
                    '',
                    '1 - Relatório de culto',
                    '2 - Relatório de célula',
                    '',
                    '❌ Digite *cancelar* para voltar.',
                ].join('\n');

                await this.sendAndSave(waId, menuText, conversation.id, dbContact.id);
            } else {
                // Multiple cells: ask which cell first
                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_report_select_cell',
                        contextJson: contextJson as any,
                    },
                });

                let menuText = '*Qual célula você quer preencher o relatório?*\n\n';
                cells.forEach((cell, idx) => {
                    menuText += `${idx + 1} - ${cell.name || `Célula #${cell.id}`}\n`;
                });
                menuText += '\n❌ Digite *cancelar* para voltar.';

                await this.sendAndSave(waId, menuText, conversation.id, dbContact.id);
            }

            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling Uvas fill report:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao buscar suas células. Tente novamente mais tarde.',
                project?.id
            );
            return { handled: true, stopProcessing: true };
        }
    }

    // ---------- Cell Selection ----------------------------------------

    private async handleReportCellSelection(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const cells = context?.cells || [];
            const idx = parseInt(normalized, 10);

            if (isNaN(idx) || idx < 1 || idx > cells.length) {
                // Invalid selection — re-show
                let menuText = '⚠️ Opção inválida. Escolha uma das opções:\n\n';
                cells.forEach((cell: any, i: number) => {
                    menuText += `${i + 1} - ${cell.name || `Célula #${cell.id}`}\n`;
                });
                menuText += '\n❌ Digite *cancelar* para voltar.';

                await this.sendAndSave(waId, menuText, conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            const selectedCell = cells[idx - 1];
            const updatedContext = { ...context, selectedCellId: selectedCell.id };

            // Move to report type selection
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_select_type',
                    contextJson: updatedContext as any,
                },
            });

            const cellName = selectedCell.name || `Célula #${selectedCell.id}`;
            const menuText = [
                `✅ Você selecionou: *${cellName}*`,
                '',
                '*Qual relatório você gostaria de preencher?*',
                '',
                '1 - Relatório de culto',
                '2 - Relatório de célula',
                '',
                '❌ Digite *cancelar* para voltar.',
            ].join('\n');

            await this.sendAndSave(waId, menuText, conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling cell selection:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao selecionar célula.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    // ---------- Report Type Selection ----------------------------------------

    private async handleReportTypeSelection(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const cellId = context?.selectedCellId;
            const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });

            if (!cellId || !project) {
                throw new Error('Missing cell ID or project');
            }

            let reportType: 'culto' | 'celula' | null = null;

            if (normalized === '1' || normalized.includes('culto')) {
                reportType = 'culto';
            } else if (normalized === '2' || normalized.includes('célula') || normalized.includes('celula')) {
                reportType = 'celula';
            } else {
                // Invalid selection — re-show
                const menuText = [
                    '⚠️ Opção inválida. Escolha uma das opções:',
                    '',
                    '1 - Relatório de culto',
                    '2 - Relatório de célula',
                    '',
                    '❌ Digite *cancelar* para voltar.',
                ].join('\n');

                await this.sendAndSave(waId, menuText, conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            // Fetch report status from Uvas API
            const reportStatus = await this.projectAdapterRegistry.getReportStatus(project, cellId, reportType);

            // Store full context including report status
            const updatedContext = { ...context, reportType, reportStatus };

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_select_date',
                    contextJson: updatedContext as any,
                },
            });

            // Build report status message
            const reportTypeLabel = reportType === 'culto' ? 'presença no culto' : 'da célula';
            let statusMessage = `*Relatório de ${reportTypeLabel} - Últimas 4 datas*\n\n`;

            if (reportStatus && reportStatus.weeks) {
                reportStatus.weeks.forEach((week: any, index: number) => {
                    const status = week.filled ? '✅ Preenchido' : '⏳ Pendente';
                    const displayPeriod = this.formatWeekPeriodLabel(week);
                    statusMessage += `${index + 1} - ${displayPeriod}: ${status}\n`;
                });
                statusMessage += '\nEscolha o número da data que você deseja trabalhar.';
                statusMessage += '\n\nℹ️ Para editar relatórios mais antigos, acesse o portal Uvas diretamente.';
            } else {
                statusMessage += 'Sem dados disponíveis.\n';
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    statusMessage,
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }
            await this.sendAndSave(waId, statusMessage, conversation.id, dbContact.id);

            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling report type selection:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar seleção.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleReportDateSelection(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const weeks = context?.reportStatus?.weeks || [];
            const idx = parseInt(normalized, 10);

            if (isNaN(idx) || idx < 1 || idx > weeks.length) {
                await this.sendAndSave(
                    waId,
                    '⚠️ Opção inválida. Escolha o número de uma data da lista enviada.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            const selectedWeek = weeks[idx - 1];
            const selectedPeriod = this.formatWeekPeriodLabel(selectedWeek);

            const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });
            const cellId = context?.selectedCellId;

            if (!project || !cellId) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Informações da célula/projeto não encontradas para continuar.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const members = await this.projectAdapterRegistry.getCellMembers(project, cellId);
            if (!members.length) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Não foi possível carregar os membros da célula para esse relatório.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const updatedContext = {
                ...context,
                selectedWeek,
                selectedPeriod,
                members,
            };

            if (selectedWeek?.filled) {
                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_report_existing_edit_confirm',
                        contextJson: updatedContext as any,
                    },
                });

                await this.sendAndSave(
                    waId,
                    `🛠️ Já existe um relatório de *${selectedPeriod}*.

Deseja editar esse relatório?
Responda *sim* para continuar ou *não* para voltar ao menu do projeto.`,
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_attendance_input',
                    contextJson: updatedContext as any,
                },
            });

            const membersMessage = this.buildMembersListMessage(selectedPeriod, members);
            await this.sendAndSave(waId, membersMessage, conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling report date selection:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao selecionar data do relatório.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleExistingReportEditConfirmation(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const isYes = normalized === 'sim' || normalized === 'yes' || normalized === 's';
            const isNo = normalized === 'não' || normalized === 'nao' || normalized === 'no' || normalized === 'n';

            if (!isYes && !isNo) {
                await this.sendAndSave(
                    waId,
                    '⚠️ Responda com *sim* para editar ou *não* para voltar ao menu do projeto.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            if (isNo) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '✅ Tudo bem! Voltando ao menu do projeto.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const context = session?.contextJson as any;
            const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });
            const cellId = context?.selectedCellId;
            const selectedWeek = context?.selectedWeek;
            const members = context?.members || [];
            const reportType = context?.reportType as ('culto' | 'celula') | undefined;

            if (!project || !cellId || !selectedWeek?.isoDate || !reportType) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Não foi possível carregar os dados para edição do relatório.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const existingReport = await this.projectAdapterRegistry.getExistingReport(
                project,
                cellId,
                selectedWeek.isoDate,
                reportType
            );

            if (!existingReport) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '⚠️ Não encontrei o relatório existente para essa data. Voltando ao menu do projeto.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const memberIds = Array.isArray(existingReport.memberIds) ? existingReport.memberIds : [];
            const selectedAttendanceMembers = members.filter((member: any) => memberIds.includes(member.id));
            const visitantes = Number(existingReport.visitorCount || 0);
            const oferta = Number(existingReport.offerAmount || 0);
            const entrega = existingReport.offerDeliveryMethod === 'CASH_TO_DISCIPULADOR'
                ? 'dinheiro'
                : existingReport.offerDeliveryMethod === 'PIX_TO_VIDEIRA'
                    ? 'pix'
                    : null;

            const updatedContext = {
                ...context,
                existingReport,
                selectedAttendanceMembers,
                selectedAttendanceMembersDraft: [],
                isEditingExistingReport: true,
                visitantes,
                oferta,
                entrega,
            };

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_attendance_confirm',
                    contextJson: updatedContext as any,
                },
            });

            const editHeader = `✏️ Você está editando o relatório de *${context?.selectedPeriod || selectedWeek.isoDate}*.`;
            await this.sendAndSave(waId, editHeader, conversation.id, dbContact.id);
            await this.sendAndSave(
                waId,
                this.buildAttendanceConfirmationMessage(selectedAttendanceMembers),
                conversation.id,
                dbContact.id
            );

            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling existing report edit confirmation:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao preparar edição do relatório.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaEditVisitantesConfirm(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        const context = session?.contextJson as any;
        const yes = normalized === 'sim' || normalized === 'yes' || normalized === 's';
        const no = normalized === 'não' || normalized === 'nao' || normalized === 'no' || normalized === 'n';

        if (yes) {
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_edit_celula_visitantes_input',
                    contextJson: context as any,
                },
            });
            await this.sendAndSave(
                waId,
                'Informe a nova quantidade de visitantes (ex: 0, 1, 2...).',
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        }

        if (no) {
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_edit_celula_oferta_confirm',
                    contextJson: context as any,
                },
            });
            await this.sendAndSave(
                waId,
                this.buildEditOfferQuestion(context),
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        }

        await this.sendAndSave(
            waId,
            '⚠️ Responda com *sim* para alterar visitantes ou *não* para manter.',
            conversation.id,
            dbContact.id
        );
        return { handled: true, stopProcessing: true };
    }

    private async handleCelulaEditVisitantesInput(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        const visitantes = parseInt(normalized, 10);
        if (isNaN(visitantes) || visitantes < 0) {
            await this.sendAndSave(
                waId,
                '⚠️ Por favor, envie um número válido de visitantes (0 ou mais).',
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        }

        const updatedContext = { ...(session?.contextJson as any), visitantes };
        await this.prisma.conversationSession.update({
            where: { contactId: dbContact.id },
            data: {
                currentActionKey: 'uvas_report_edit_celula_oferta_confirm',
                contextJson: updatedContext as any,
            },
        });

        await this.sendAndSave(
            waId,
            this.buildEditOfferQuestion(updatedContext),
            conversation.id,
            dbContact.id
        );
        return { handled: true, stopProcessing: true };
    }

    private async handleCelulaEditOfertaConfirm(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        const context = session?.contextJson as any;
        const yes = normalized === 'sim' || normalized === 'yes' || normalized === 's';
        const no = normalized === 'não' || normalized === 'nao' || normalized === 'no' || normalized === 'n';

        if (yes) {
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_edit_celula_oferta_input',
                    contextJson: context as any,
                },
            });
            await this.sendAndSave(
                waId,
                'Informe o novo valor da oferta em reais. Envie *0* se não houve oferta.',
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        }

        if (no) {
            return this.handleCelulaSummary(dbContact, waId, conversation, context);
        }

        await this.sendAndSave(
            waId,
            '⚠️ Responda com *sim* para alterar oferta ou *não* para manter.',
            conversation.id,
            dbContact.id
        );
        return { handled: true, stopProcessing: true };
    }

    private async handleCelulaEditOfertaInput(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        const oferta = parseFloat(normalized.replace(',', '.'));
        if (isNaN(oferta) || oferta < 0) {
            await this.sendAndSave(
                waId,
                '⚠️ Informe um valor válido para oferta (0 ou mais).',
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        }

        const updatedContext = { ...(session?.contextJson as any), oferta };

        if (oferta === 0) {
            updatedContext.entrega = null;
            return this.handleCelulaSummary(dbContact, waId, conversation, updatedContext);
        }

        await this.prisma.conversationSession.update({
            where: { contactId: dbContact.id },
            data: {
                currentActionKey: 'uvas_report_edit_celula_entrega_input',
                contextJson: updatedContext as any,
            },
        });

        await this.sendAndSave(
            waId,
            'Como a oferta foi entregue? Responda com *dinheiro*, *pix* ou *não* (ainda não entregue).',
            conversation.id,
            dbContact.id
        );
        return { handled: true, stopProcessing: true };
    }

    private async handleCelulaEditEntregaInput(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        const normalizedAnswer = normalized.toLowerCase().trim();
        let entrega: string | null;

        if (normalizedAnswer === 'dinheiro') {
            entrega = 'dinheiro';
        } else if (normalizedAnswer === 'pix') {
            entrega = 'pix';
        } else if (normalizedAnswer === 'não' || normalizedAnswer === 'nao') {
            entrega = null;
        } else {
            await this.sendAndSave(
                waId,
                '⚠️ Responda com *dinheiro*, *pix* ou *não*.',
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        }

        const updatedContext = { ...(session?.contextJson as any), entrega };
        return this.handleCelulaSummary(dbContact, waId, conversation, updatedContext);
    }

    private async handleAttendanceInput(
        rawMessageText: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const members = context?.members || [];
            const selectedPeriod = context?.selectedPeriod || 'data selecionada';
            const previousDraftMembers: Array<{ id: number; name: string }> = context?.selectedAttendanceMembersDraft || [];

            const draftEdit = this.applyDraftEditCommand(rawMessageText, previousDraftMembers);
            if (draftEdit) {
                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_report_attendance_input',
                        contextJson: {
                            ...context,
                            selectedAttendanceMembersDraft: draftEdit.updatedDraft,
                        } as any,
                    },
                });

                await this.sendAndSave(waId, draftEdit.feedbackText, conversation.id, dbContact.id);
                await this.sendAndSave(waId, this.buildMembersListMessage(selectedPeriod, members), conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            const parseResult = this.parseAttendanceSelection(rawMessageText, members);
            const identifiedMembers = this.mergeSelectedMembers(previousDraftMembers, parseResult.selectedMembers);

            if (!identifiedMembers.length) {
                const feedback = this.buildAttendanceParseFeedback(parseResult);
                await this.sendAndSave(
                    waId,
                    feedback || '⚠️ Não consegui identificar nenhum membro. Envie novamente os *números* ou *nomes* dos presentes.',
                    conversation.id,
                    dbContact.id
                );
                await this.sendAndSave(waId, this.buildMembersListMessage(selectedPeriod, members), conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            if (parseResult.ambiguousTokens.length || parseResult.unresolvedTokens.length) {
                let text = '⚠️ Identifiquei alguns presentes, mas preciso que você refine alguns pontos antes de continuar.\n\n';
                text += this.buildAttendanceParseFeedback({
                    selectedMembers: identifiedMembers,
                    ambiguousTokens: parseResult.ambiguousTokens,
                    unresolvedTokens: parseResult.unresolvedTokens,
                });
                text += '\n\nPor favor, envie *apenas os itens pendentes* (ambíguos/não encontrados). Você pode usar os números para evitar ambiguidade.';

                await this.prisma.conversationSession.update({
                    where: { contactId: dbContact.id },
                    data: {
                        currentActionKey: 'uvas_report_attendance_input',
                        contextJson: {
                            ...context,
                            selectedAttendanceMembersDraft: identifiedMembers,
                        } as any,
                    },
                });

                await this.sendAndSave(waId, text, conversation.id, dbContact.id);
                await this.sendAndSave(waId, this.buildMembersListMessage(selectedPeriod, members), conversation.id, dbContact.id);
                return { handled: true, stopProcessing: true };
            }

            const updatedContext = {
                ...context,
                selectedAttendanceMembers: identifiedMembers,
                selectedAttendanceMembersDraft: [],
            };

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_attendance_confirm',
                    contextJson: updatedContext as any,
                },
            });

            await this.sendAndSave(
                waId,
                this.buildAttendanceConfirmationMessage(identifiedMembers),
                conversation.id,
                dbContact.id
            );

            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling attendance input:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar os presentes informados.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleAttendanceConfirmation(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        const context = session?.contextJson as any;
        const members = context?.members || [];
        const selectedAttendanceMembers: Array<{ id: number; name: string }> = context?.selectedAttendanceMembers || [];
        const selectedPeriod = context?.selectedPeriod || 'data selecionada';
        const reportType = context?.reportType as ('culto' | 'celula') | undefined;

        const isYes = normalized === 'sim' || normalized === 'yes';
        const isNo = normalized === 'não' || normalized === 'nao' || normalized === 'não.' || normalized === 'nao.';

        const selectionEdit = this.applySelectionEditCommand(normalized, selectedAttendanceMembers, members);
        if (selectionEdit) {
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_attendance_confirm',
                    contextJson: {
                        ...context,
                        selectedAttendanceMembers: selectionEdit.updatedSelection,
                    } as any,
                },
            });

            await this.sendAndSave(waId, selectionEdit.feedbackText, conversation.id, dbContact.id);

            if (selectionEdit.updatedSelection.length > 0) {
                await this.sendAndSave(
                    waId,
                    this.buildAttendanceConfirmationMessage(selectionEdit.updatedSelection),
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_attendance_input',
                    contextJson: {
                        ...context,
                        selectedAttendanceMembers: [],
                        selectedAttendanceMembersDraft: [],
                    } as any,
                },
            });
            await this.sendAndSave(waId, this.buildMembersListMessage(selectedPeriod, members), conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        }

        if (isYes) {
            // Confirmation received
            if (reportType === 'culto') {
                // For culto: submit report directly
                return this.handleCultoConfirmation(dbContact, waId, conversation, session, selectedAttendanceMembers);
            } else if (reportType === 'celula') {
                if (context?.isEditingExistingReport) {
                    await this.prisma.conversationSession.update({
                        where: { contactId: dbContact.id },
                        data: {
                            currentActionKey: 'uvas_report_edit_celula_visitantes_confirm',
                            contextJson: context as any,
                        },
                    });

                    await this.sendAndSave(
                        waId,
                        `Deseja alterar a quantidade de visitantes?\nValor atual: *${context?.visitantes ?? 0}*\n\nResponda *sim* ou *não*.`,
                        conversation.id,
                        dbContact.id
                    );
                    return { handled: true, stopProcessing: true };
                }
                // For célula: collect extra data (visitantes, oferta, entrega)
                return this.handleCelulaConfirmation(dbContact, waId, conversation, session);
            } else {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '🛠️ Tipo de relatório não identificado. Por favor, tente novamente.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }
        }

        if (isNo) {
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_attendance_input',
                    contextJson: {
                        ...context,
                        selectedAttendanceMembers: [],
                        selectedAttendanceMembersDraft: [],
                    } as any,
                },
            });

            await this.sendAndSave(
                waId,
                'Sem problemas! Limpei a seleção atual. Vou te enviar a lista novamente.',
                conversation.id,
                dbContact.id
            );
            await this.sendAndSave(waId, this.buildMembersListMessage(selectedPeriod, members), conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        }

        await this.sendAndSave(
            waId,
            '⚠️ Resposta inválida. Use *sim* para confirmar, *não* para limpar, ou comandos como *adicionar Maria* / *remover 2*.',
            conversation.id,
            dbContact.id
        );
        return { handled: true, stopProcessing: true };
    }

    // ---------- direct button replies from report reminder templates ----

    private async handleCultoConfirmation(
        dbContact: any,
        waId: string,
        conversation: any,
        session: any,
        selectedMembers: Array<{ id: number; name: string }>
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const cellId = context?.selectedCellId;
            const selectedWeek = context?.selectedWeek;
            const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });

            if (!project || !cellId || !selectedWeek) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Informações do relatório não encontradas.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            // Submit culto report to Uvas API
            const submitResult = await this.projectAdapterRegistry.submitReport(
                project,
                cellId,
                'culto',
                selectedWeek.isoDate,
                selectedMembers
            );

            if (submitResult.success) {
                let confirmMsg = '*✅ Relatório de culto enviado com sucesso!*\n\n';
                confirmMsg += 'Presentes registrados:\n';
                selectedMembers.forEach((member, idx) => {
                    confirmMsg += `${idx + 1} - ${member.name}\n`;
                });
                confirmMsg += '\n' + submitResult.message;
                await this.finishFlowWithProjectMenu(dbContact, waId, conversation, confirmMsg, session?.activeProjectId);
            } else {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    `❌ ${submitResult.message}`,
                    session?.activeProjectId
                );
            }

            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling culto confirmation:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao enviar relatório do culto.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaConfirmation(
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            // Transition to asking for visitantes count
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_celula_visitantes',
                    contextJson: session?.contextJson as any,
                },
            });

            await this.sendAndSave(
                waId,
                'ótimo! Agora preciso de mais informações para completar o relatório da célula.\n\n*Quantos visitantes compareceram?*\n\nResponda com um número (ex: 0, 1, 2...)',
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling celula confirmation:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar relatório da célula.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaVisitantesInput(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const visitantes = parseInt(normalized, 10);
            if (isNaN(visitantes) || visitantes < 0) {
                await this.sendAndSave(
                    waId,
                    '⚠️ Por favor, responda com um número válido (ex: 0, 1, 2...).',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            const context = session?.contextJson as any;
            const updatedContext = { ...context, visitantes };

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_celula_oferta',
                    contextJson: updatedContext as any,
                },
            });

            await this.sendAndSave(
                waId,
                `✅ Registrado: *${visitantes}* visitante(s).\n\n*Houve oferta?*\n\nResponda *sim* ou *não*.`,
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling visitantes input:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar visitantes.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaOfertaInput(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const normalizedAnswer = normalized.toLowerCase().trim();
            const houveOferta = normalizedAnswer === 'sim' || normalizedAnswer === 'yes';

            if (normalizedAnswer !== 'sim' && normalizedAnswer !== 'não' && normalizedAnswer !== 'nao'
                && normalizedAnswer !== 'yes' && normalizedAnswer !== 'no') {
                await this.sendAndSave(
                    waId,
                    '⚠️ Por favor, responda com *sim* ou *não*.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            const updatedContext = { ...context, houveOferta };

            if (!houveOferta) {
                // No offering, go directly to summary
                updatedContext.oferta = 0;
                updatedContext.entrega = null;
                return this.handleCelulaSummary(dbContact, waId, conversation, updatedContext);
            }

            // Ask for offering amount
            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_celula_entrega',
                    contextJson: updatedContext as any,
                },
            });

            await this.sendAndSave(
                waId,
                '*Qual foi o valor da oferta?*\n\nResponda com um número (ex: 10, 50, 100...)',
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling oferta input:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar oferta.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaEntregaInput(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const oferta = parseInt(normalized, 10);

            if (isNaN(oferta) || oferta < 0) {
                await this.sendAndSave(
                    waId,
                    '⚠️ Por favor, responda com um número válido (ex: 10, 50, 100...).',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            const updatedContext = { ...context, oferta };

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_celula_resumo',
                    contextJson: updatedContext as any,
                },
            });

            await this.sendAndSave(
                waId,
                `✅ Registrado: oferta de *R$ ${oferta}*.\n\n*Essa oferta já foi entregue a sua liderança?*\n\nResponda:\n- *dinheiro* (entrega em dinheiro físico ao discipulador)\n- *pix* (transferência PIX na conta da Videira)\n- *não* (ainda não foi entregue)`,
                conversation.id,
                dbContact.id
            );
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling entrega input (oferta amount):', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar valor da oferta.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaResumoInput(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const normalizedAnswer = normalized.toLowerCase().trim();
            let entrega: string | null = null;

            if (normalizedAnswer === 'dinheiro') {
                entrega = 'dinheiro';
            } else if (normalizedAnswer === 'pix') {
                entrega = 'pix';
            } else if (normalizedAnswer === 'não' || normalizedAnswer === 'nao') {
                entrega = null;
            } else {
                await this.sendAndSave(
                    waId,
                    '⚠️ Por favor, responda com *dinheiro*, *pix* ou *não*.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            const updatedContext = { ...context, entrega };
            return this.handleCelulaSummary(dbContact, waId, conversation, updatedContext);
        } catch (error) {
            console.log('Error handling celula resumo input:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao processar entrega da oferta.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaEnvio(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any,
        session: any
    ): Promise<ActionResult> {
        try {
            const context = session?.contextJson as any;
            const normalizedAnswer = normalized.toLowerCase().trim();

            const cancelAnswers = ['cancelar', 'cancel', 'não', 'nao', 'no', 'nn'];

            if (cancelAnswers.includes(normalizedAnswer)) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Relatório da célula cancelado.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const confirmAnswers = ['confirmar', 'confirm', 'sim', 'yes', 's', 'y'];
            if (!confirmAnswers.includes(normalizedAnswer)) {
                await this.sendAndSave(
                    waId,
                    '⚠️ Digite *sim* para enviar ou *não* para descartar.',
                    conversation.id,
                    dbContact.id
                );
                return { handled: true, stopProcessing: true };
            }

            // Submit célula report to Uvas API
            const cellId = context?.selectedCellId;
            const selectedWeek = context?.selectedWeek;
            const selectedMembers: Array<{ id: number; name: string }> = context?.selectedAttendanceMembers || [];
            const project = await this.prisma.project.findUnique({ where: { id: session?.activeProjectId } });

            if (!project || !cellId || !selectedWeek) {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    '❌ Informações do relatório não encontradas.',
                    session?.activeProjectId
                );
                return { handled: true, stopProcessing: true };
            }

            const extras = {
                visitantes: context?.visitantes || 0,
                oferta: context?.oferta || 0,
                entrega: context?.entrega || null,
            };

            const submitResult = await this.projectAdapterRegistry.submitReport(
                project,
                cellId,
                'celula',
                selectedWeek.isoDate,
                selectedMembers,
                extras
            );

            if (submitResult.success) {
                let confirmMsg = '*✅ Relatório da célula enviado com sucesso!*\n\n';
                confirmMsg += 'Presentes registrados:\n';
                selectedMembers.forEach((member, idx) => {
                    confirmMsg += `${idx + 1} - ${member.name}\n`;
                });
                confirmMsg += `\nVisitantes: ${extras.visitantes}\n`;
                confirmMsg += `Oferta: R$ ${extras.oferta}\n`;
                if (extras.entrega) {
                    confirmMsg += `Entrega: ${extras.entrega === 'dinheiro' ? 'Dinheiro ao discipulador' : 'PIX na Videira'}\n`;
                }
                confirmMsg += '\n' + submitResult.message;
                await this.finishFlowWithProjectMenu(dbContact, waId, conversation, confirmMsg, session?.activeProjectId);
            } else {
                await this.finishFlowWithProjectMenu(
                    dbContact,
                    waId,
                    conversation,
                    `❌ ${submitResult.message}`,
                    session?.activeProjectId
                );
            }

            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error handling celula envio:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao enviar relatório da célula.',
                session?.activeProjectId
            );
            return { handled: true, stopProcessing: true };
        }
    }

    private async handleCelulaSummary(
        dbContact: any,
        waId: string,
        conversation: any,
        context: any
    ): Promise<ActionResult> {
        try {
            const selectedMembers: Array<{ id: number; name: string }> = context?.selectedAttendanceMembers || [];
            const visitantes = context?.visitantes || 0;
            const oferta = context?.oferta || 0;
            const entrega = context?.entrega || null;

            // Build summary message
            let summaryMsg = '*📋 Resumo do Relatório da Célula*\n\n';
            summaryMsg += '*Presentes:*\n';
            selectedMembers.forEach((member, idx) => {
                summaryMsg += `${idx + 1} - ${member.name}\n`;
            });
            summaryMsg += `\n*Visitantes:* ${visitantes}\n`;
            summaryMsg += `*Oferta:* R$ ${oferta}\n`;
            if (entrega) {
                summaryMsg += `*Entrega da oferta:* ${entrega === 'dinheiro' ? 'Dinheiro físico ao discipulador' : 'PIX na conta da Videira'}\n`;
            }
            summaryMsg += '\nDigite *sim* para enviar o relatório ou *não* para descartar.';

            await this.prisma.conversationSession.update({
                where: { contactId: dbContact.id },
                data: {
                    currentActionKey: 'uvas_report_celula_enviar',
                    contextJson: context as any,
                },
            });

            await this.sendAndSave(waId, summaryMsg, conversation.id, dbContact.id);
            return { handled: true, stopProcessing: true };
        } catch (error) {
            console.log('Error building celula summary:', error);
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '❌ Erro ao preparar resumo do relatório.',
                dbContact?.projectId
            );
            return { handled: true, stopProcessing: true };
        }
    }
    
    private async handleDirectReportButtonReply(
        normalized: string,
        dbContact: any,
        waId: string,
        conversation: any
    ): Promise<ActionResult> {
        if (normalized.includes('presença no culto')) {
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '✍️ Em breve você poderá preencher o relatório de presença no culto por aqui!',
                dbContact?.projectId
            );
        } else {
            // "preencher relatório da célula"
            await this.finishFlowWithProjectMenu(
                dbContact,
                waId,
                conversation,
                '✍️ Em breve você poderá preencher o relatório da célula por aqui!',
                dbContact?.projectId
            );
        }

        return { handled: true, stopProcessing: true };
    }

    // ---------- helpers ------------------------------------------------

    private async sendAndSave(to: string, text: string, conversationId: string, contactId: string): Promise<void> {
        const sent = await this.outboundMessenger.sendTextMessage(to, text);
        await this.messagePersistence.saveOutboundMessage(conversationId, contactId, text, sent?.messages?.[0]?.id);
    }

    private async finishFlowWithProjectMenu(
        dbContact: any,
        waId: string,
        conversation: any,
        message: string,
        projectId?: number | null
    ): Promise<void> {
        await this.sessionService.resetToIdle(dbContact.id);
        await this.sendAndSave(waId, message, conversation.id, dbContact.id);

        const resolvedProjectId = projectId || dbContact?.projectId;
        if (!resolvedProjectId) {
            return;
        }

        await this.projectContextService.sendProjectMenu(
            { id: dbContact.id, waId },
            resolvedProjectId,
            conversation.id
        );
    }

    private buildEditOfferQuestion(context: any): string {
        const offerAmount = Number(context?.oferta || 0);
        const delivery = context?.entrega === 'dinheiro'
            ? 'Dinheiro ao discipulador'
            : context?.entrega === 'pix'
                ? 'PIX na Videira'
                : 'Ainda não entregue';

        return `Deseja alterar a oferta?\nValor atual: *R$ ${offerAmount}*\nEntrega atual: *${delivery}*\n\nResponda *sim* ou *não*.`;
    }

    private buildMembersListMessage(selectedPeriod: string, members: Array<{ id: number; name: string }>): string {
        let text = `*Membros da célula para ${selectedPeriod}:*\n\n`;
        members.forEach((member, index) => {
            text += `${index + 1} - ${member.name}\n`;
        });
        text += '\nEnvie os *números* ou *nomes* dos membros presentes (ex: 1, 3, Maria).';
        return text;
    }
    private buildAttendanceConfirmationMessage(selectedMembers: Array<{ id: number; name: string }>): string {
        let text = '*Confirma os presentes identificados?*\n\n';
        selectedMembers.forEach((member, index) => {
            text += `${index + 1} - ${member.name}\n`;
        });
        text += '\nDigite *sim* para confirmar ou *não* para limpar a seleção e recomeçar.';
        text += '\n\nVocê também pode editar agora com comandos:';
        text += '\n- *adicionar Nome/Numero*';
        text += '\n- *remover Nome/Numero*';
        return text;
    }

    private parseAttendanceSelection(
        rawText: string,
        members: Array<{ id: number; name: string }>
    ): {
        selectedMembers: Array<{ id: number; name: string }>;
        ambiguousTokens: Array<{ token: string; candidates: Array<{ id: number; name: string; index: number }> }>;
        unresolvedTokens: string[];
    } {
        const tokens = this.tokenizeAttendanceInput(rawText);
        this.logDebug(`Input: "${rawText}" → Tokens: [${tokens.map((t) => `"${t}"`).join(', ')}]`);

        const selected = new Map<number, { id: number; name: string }>();
        const ambiguousTokens: Array<{ token: string; candidates: Array<{ id: number; name: string; index: number }> }> = [];
        const unresolvedTokens: string[] = [];
        const processedIndices = new Set<number>();

        // Process each token with multi-tier matching strategy
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            // Check if already processed as part of a composed name
            if (processedIndices.has(i)) {
                this.logDebug(`  Token #${i} "${token}": Already processed (part of composed name)`);
                continue;
            }

            const numeric = Number(token);
            if (Number.isInteger(numeric) && numeric >= 1 && numeric <= members.length) {
                const member = members[numeric - 1];
                selected.set(member.id, member);
                processedIndices.add(i);
                this.logDebug(`  Token #${i} "${token}": NUMERIC → Member #${member.id} "${member.name}"`);
                continue;
            }

            const normalizedToken = this.normalizeName(token);
            if (!normalizedToken) {
                processedIndices.add(i);
                this.logDebug(`  Token #${i} "${token}": Empty after normalization`);
                continue;
            }

            this.logDebug(`  Token #${i} "${token}" (normalized: "${normalizedToken}"):`);

            // Tier 1: Exact Match
            const exactMatches = members.filter((member) => this.normalizeName(member.name) === normalizedToken);
            this.logDebug(`    Tier 1 Exact: ${exactMatches.length} match(es)`);
            
            if (exactMatches.length === 1) {
                selected.set(exactMatches[0].id, exactMatches[0]);
                processedIndices.add(i);
                this.logDebug(`      → RESOLVED with "${exactMatches[0].name}"`);
                continue;
            }

            if (exactMatches.length > 1) {
                const scored = this.scoreMatchesByPosition(exactMatches, normalizedToken);
                const bestScore = scored[0]?.score || 0;
                const secondBestScore = scored[1]?.score || 0;
                
                // If there's a significant score difference, resolve with top candidate
                if (scored.length > 0 && bestScore > secondBestScore * 1.3) {
                    selected.set(scored[0].member.id, scored[0].member);
                    processedIndices.add(i);
                    this.logDebug(`      Scored: ${scored.map((s) => `"${s.member.name}"(${s.score.toFixed(2)})`).join(', ')}`);
                    this.logDebug(`      → RESOLVED with best match "${scored[0].member.name}" (score ${scored[0].score.toFixed(2)})`);
                    continue;
                }

                ambiguousTokens.push({
                    token,
                    candidates: exactMatches.map((candidate) => ({
                        ...candidate,
                        index: members.findIndex((m) => m.id === candidate.id) + 1,
                    })),
                });
                processedIndices.add(i);
                this.logDebug(`      Scored: ${scored.map((s) => `"${s.member.name}"(${s.score.toFixed(2)})`).join(', ')}`);
                this.logDebug(`      → AMBIGUOUS (${exactMatches.length} candidates)`);
                continue;
            }

            // Tier 2: Partial Match (with consecutive composition detection)
            const partialMatches = members.filter((member) => this.matchesTokenAtWordBoundary(this.normalizeName(member.name), normalizedToken));
            this.logDebug(`    Tier 2 Partial: ${partialMatches.length} match(es)`);
            
            if (partialMatches.length === 1) {
                // Check if next token can be combined to form a composed name
                const nextToken = i + 1 < tokens.length ? tokens[i + 1] : null;
                if (nextToken && !processedIndices.has(i + 1)) {
                    const normalizedNextToken = this.normalizeName(nextToken);
                    const memberNormalized = this.normalizeName(partialMatches[0].name);
                    
                    // If both current and next tokens match word boundaries in the member name,
                    // it might be a composed name - combine them
                    if (this.matchesTokenAtWordBoundary(memberNormalized, normalizedToken)
                        && this.matchesTokenAtWordBoundary(memberNormalized, normalizedNextToken)) {
                        // Verify they're actually part of a composed name by checking word order
                        const memberWords = memberNormalized.split(/\s+/).filter(Boolean);
                        const tokenIndex = this.findMatchedWordIndex(memberWords, normalizedToken);
                        const nextTokenIndex = this.findMatchedWordIndex(memberWords, normalizedNextToken, tokenIndex + 1);
                        
                        if (tokenIndex < nextTokenIndex) {
                            selected.set(partialMatches[0].id, partialMatches[0]);
                            processedIndices.add(i);
                            processedIndices.add(i + 1);
                            this.logDebug(`      + Composition detected: "${token}" + "${nextToken}" → "${partialMatches[0].name}"`);
                            this.logDebug(`      → RESOLVED (composed)`);
                            continue;
                        }
                    }
                }
                
                // Single partial match without composition
                selected.set(partialMatches[0].id, partialMatches[0]);
                processedIndices.add(i);
                this.logDebug(`      → RESOLVED with "${partialMatches[0].name}" (partial match)`);
                continue;
            }

            if (partialMatches.length > 1) {
                const scored = this.scoreMatchesByPosition(partialMatches, normalizedToken);
                const bestScore = scored[0]?.score || 0;
                const secondBestScore = scored[1]?.score || 0;
                
                // If there's a significant score difference, resolve with top candidate
                if (scored.length > 0 && bestScore > secondBestScore * 1.3) {
                    selected.set(scored[0].member.id, scored[0].member);
                    processedIndices.add(i);
                    this.logDebug(`      Scored: ${scored.map((s) => `"${s.member.name}"(${s.score.toFixed(2)})`).join(', ')}`);
                    this.logDebug(`      → RESOLVED with best match "${scored[0].member.name}" (score ${scored[0].score.toFixed(2)})`);
                    continue;
                }

                ambiguousTokens.push({
                    token,
                    candidates: partialMatches.map((candidate) => ({
                        ...candidate,
                        index: members.findIndex((m) => m.id === candidate.id) + 1,
                    })),
                });
                processedIndices.add(i);
                this.logDebug(`      Scored: ${scored.map((s) => `"${s.member.name}"(${s.score.toFixed(2)})`).join(', ')}`);
                this.logDebug(`      → AMBIGUOUS (${partialMatches.length} candidates)`);
                continue;
            }

            // Tier 3: Fuzzy Match
            const fuzzyMatches = members.filter((member) => this.isSmallNameDifference(this.normalizeName(member.name), normalizedToken));
            this.logDebug(`    Tier 3 Fuzzy: ${fuzzyMatches.length} match(es)`);
            
            if (fuzzyMatches.length === 1) {
                selected.set(fuzzyMatches[0].id, fuzzyMatches[0]);
                processedIndices.add(i);
                this.logDebug(`      → RESOLVED with "${fuzzyMatches[0].name}" (fuzzy match)`);
                continue;
            }

            if (fuzzyMatches.length > 1) {
                const scored = this.scoreFuzzyMatches(fuzzyMatches, normalizedToken);
                const best = scored[0];
                const second = scored[1];
                
                // Fuzzy tie-break: prefer lower Levenshtein distance, then better position score
                if (best && (!second
                    || best.distance < second.distance
                    || (best.distance === second.distance && best.score > second.score * 1.3))) {
                    selected.set(best.member.id, best.member);
                    processedIndices.add(i);
                    this.logDebug(`      Scored: ${scored.map((s) => `"${s.member.name}"(d=${s.distance}, p=${s.score.toFixed(2)})`).join(', ')}`);
                    this.logDebug(`      → RESOLVED with best fuzzy match "${best.member.name}" (distance ${best.distance}, position ${best.score.toFixed(2)})`);
                    continue;
                }

                ambiguousTokens.push({
                    token,
                    candidates: fuzzyMatches.map((candidate) => ({
                        ...candidate,
                        index: members.findIndex((m) => m.id === candidate.id) + 1,
                    })),
                });
                processedIndices.add(i);
                this.logDebug(`      Scored: ${scored.map((s) => `"${s.member.name}"(d=${s.distance}, p=${s.score.toFixed(2)})`).join(', ')}`);
                this.logDebug(`      → AMBIGUOUS (${fuzzyMatches.length} candidates)`);
                continue;
            }

            // Not resolved at any tier
            unresolvedTokens.push(token);
            processedIndices.add(i);
            this.logDebug(`      → UNRESOLVED (no matches in any tier)`);
        }

        const result = {
            selectedMembers: Array.from(selected.values()),
            ambiguousTokens,
            unresolvedTokens,
        };
        
        this.logDebug(`Result: ${result.selectedMembers.length} resolved, ${result.ambiguousTokens.length} ambiguous, ${result.unresolvedTokens.length} unresolved\n`);
        return result;
    }

    private tokenizeAttendanceInput(rawText: string): string[] {
        const text = String(rawText || '').trim();
        if (!text) {
            return [];
        }

        // If user used explicit separators, split by them and parse each chunk.
        // Chunks with only names are preserved as a single token (keeps composed names),
        // while mixed chunks (numbers + names) are split to retain numeric intent.
        if (/[\n,;]+/.test(text)) {
            const chunks = text
                .split(/[\n,;]+/)
                .map((value) => value.trim())
                .filter((value) => value.length > 0);

            const tokens: string[] = [];
            chunks.forEach((chunk) => {
                const compactChunk = chunk.replace(/\s+/g, ' ').trim();
                if (!compactChunk) {
                    return;
                }

                // Pure numeric chunk (supports spaces): "1 3 5"
                if (/^(\d+\s+)*\d+$/.test(compactChunk)) {
                    compactChunk
                        .split(/\s+/)
                        .map((value) => value.trim())
                        .filter((value) => value.length > 0)
                        .forEach((value) => tokens.push(value));
                    return;
                }

                // Mixed chunk (numbers + names): split by space so numeric IDs are preserved
                if (/\d/.test(compactChunk) && /[A-Za-zÀ-ÿ]/.test(compactChunk)) {
                    compactChunk
                        .split(/\s+/)
                        .map((value) => value.trim())
                        .filter((value) => value.length > 0)
                        .forEach((value) => tokens.push(value));
                    return;
                }

                // Name-only chunk: preserve composed names (e.g., "Maria Clara")
                tokens.push(compactChunk);
            });

            return tokens;
        }

        const compactText = text.replace(/\s+/g, ' ').trim();

        // Accept plain space-separated numeric input: "1 2 5"
        if (/^(\d+\s+)*\d+$/.test(compactText)) {
            return compactText
                .split(/\s+/)
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
        }

        // For mixed input or names without explicit separators:
        // Return individual space-separated tokens (no combining)
        // This allows the matching algorithm to handle composed names intelligently
        return compactText
            .split(/\s+/)
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
    }

    private mergeSelectedMembers(
        previousMembers: Array<{ id: number; name: string }>,
        currentMembers: Array<{ id: number; name: string }>
    ): Array<{ id: number; name: string }> {
        const merged = new Map<number, { id: number; name: string }>();
        previousMembers.forEach((member) => merged.set(member.id, member));
        currentMembers.forEach((member) => merged.set(member.id, member));
        return Array.from(merged.values());
    }

    private applyDraftEditCommand(
        rawText: string,
        draftMembers: Array<{ id: number; name: string }>
    ): { updatedDraft: Array<{ id: number; name: string }>; feedbackText: string } | null {
        const text = String(rawText || '').trim();
        if (!text) {
            return null;
        }

        const normalized = this.normalizeName(text);
        if (!normalized) {
            return null;
        }

        const clearDraftCommands = new Set(['limpar', 'limpar lista', 'zerar', 'resetar']);
        if (clearDraftCommands.has(normalized)) {
            return {
                updatedDraft: [],
                feedbackText: '✅ Rascunho de presença limpo. Envie novamente os *números* ou *nomes* dos presentes.',
            };
        }

        const removeCommandMatch = normalized.match(/^(remover|tirar|excluir)\s+(.+)$/);
        if (!removeCommandMatch) {
            return null;
        }

        if (!draftMembers.length) {
            return {
                updatedDraft: [],
                feedbackText: '⚠️ Seu rascunho está vazio. Envie os *números* ou *nomes* dos presentes para começar.',
            };
        }

        const targetsRaw = text.replace(/^(remover|tirar|excluir)\s+/i, '').trim();
        const targetTokens = this.tokenizeAttendanceInput(targetsRaw);
        const updatedDraftMap = new Map<number, { id: number; name: string }>();
        draftMembers.forEach((member) => updatedDraftMap.set(member.id, member));

        const removedNames: string[] = [];
        const unresolvedTargets: string[] = [];
        const ambiguousTargets: Array<{ token: string; candidates: string[] }> = [];

        targetTokens.forEach((token) => {
            const numeric = Number(token);
            if (Number.isInteger(numeric) && numeric >= 1 && numeric <= draftMembers.length) {
                const member = draftMembers[numeric - 1];
                if (updatedDraftMap.delete(member.id)) {
                    removedNames.push(member.name);
                }
                return;
            }

            const normalizedToken = this.normalizeName(token);
            if (!normalizedToken) {
                return;
            }

            const exact = draftMembers.filter((member) => this.normalizeName(member.name) === normalizedToken);
            if (exact.length === 1) {
                if (updatedDraftMap.delete(exact[0].id)) {
                    removedNames.push(exact[0].name);
                }
                return;
            }

            if (exact.length > 1) {
                ambiguousTargets.push({
                    token,
                    candidates: exact.map((member) => member.name),
                });
                return;
            }

            const partial = draftMembers.filter((member) => this.matchesTokenAtWordBoundary(this.normalizeName(member.name), normalizedToken));
            if (partial.length === 1) {
                if (updatedDraftMap.delete(partial[0].id)) {
                    removedNames.push(partial[0].name);
                }
                return;
            }

            if (partial.length > 1) {
                ambiguousTargets.push({
                    token,
                    candidates: partial.map((member) => member.name),
                });
                return;
            }

            const fuzzy = draftMembers.filter((member) => this.isSmallNameDifference(this.normalizeName(member.name), normalizedToken));
            if (fuzzy.length === 1) {
                if (updatedDraftMap.delete(fuzzy[0].id)) {
                    removedNames.push(fuzzy[0].name);
                }
                return;
            }

            unresolvedTargets.push(token);
        });

        const updatedDraft = Array.from(updatedDraftMap.values());
        let feedback = '';
        if (removedNames.length) {
            feedback += '*Removidos do rascunho:*\n';
            removedNames.forEach((name) => {
                feedback += `- ${name}\n`;
            });
            feedback += '\n';
        }

        if (ambiguousTargets.length) {
            feedback += '*Não removi por ambiguidade:*\n';
            ambiguousTargets.forEach((item) => {
                feedback += `- "${item.token}":\n`;
                item.candidates.forEach((candidate) => {
                    feedback += `  - ${candidate}\n`;
                });
            });
            feedback += '\n';
        }

        if (unresolvedTargets.length) {
            feedback += '*Não encontrei para remover:*\n';
            unresolvedTargets.forEach((token) => {
                feedback += `- ${token}\n`;
            });
            feedback += '\n';
        }

        if (updatedDraft.length) {
            feedback += '*Rascunho atual de presentes:*\n';
            updatedDraft.forEach((member, index) => {
                feedback += `${index + 1} - ${member.name}\n`;
            });
            feedback += '\n';
            feedback += 'Envie os próximos *números* ou *nomes*, ou use `remover ...` novamente.';
        } else {
            feedback += '⚠️ O rascunho ficou vazio. Envie os *números* ou *nomes* dos presentes para continuar.';
        }

        return {
            updatedDraft,
            feedbackText: feedback.trim(),
        };
    }

    private applySelectionEditCommand(
        rawText: string,
        currentSelection: Array<{ id: number; name: string }>,
        members: Array<{ id: number; name: string }>
    ): { updatedSelection: Array<{ id: number; name: string }>; feedbackText: string } | null {
        const text = String(rawText || '').trim();
        if (!text) {
            return null;
        }

        const normalized = this.normalizeName(text);
        if (!normalized) {
            return null;
        }

        const addMatch = normalized.match(/^(adicionar|colocar|bota|coloca|põe|poe\.)\s+(.+)$/);
        if (addMatch) {
            const targetsRaw = text.replace(/^(adicionar|colocar|bota|coloca|põe|poe)\s+/i, '').trim();
            const parse = this.parseAttendanceSelection(targetsRaw, members);
            const updatedSelection = this.mergeSelectedMembers(currentSelection, parse.selectedMembers);

            let feedback = '';
            if (parse.selectedMembers.length) {
                feedback += '*Adicionados à seleção:*\n';
                parse.selectedMembers.forEach((member) => {
                    feedback += `- ${member.name}\n`;
                });
                feedback += '\n';
            }

            if (parse.ambiguousTokens.length || parse.unresolvedTokens.length) {
                feedback += this.buildAttendanceParseFeedback({
                    selectedMembers: [],
                    ambiguousTokens: parse.ambiguousTokens,
                    unresolvedTokens: parse.unresolvedTokens,
                });
            }

            return {
                updatedSelection,
                feedbackText: (feedback || '⚠️ Não consegui adicionar nenhum membro com esse comando.').trim(),
            };
        }

        const removeMatch = normalized.match(/^(remover|tirar|tira|remove|cancela)\s+(.+)$/);
        if (!removeMatch) {
            return null;
        }

        if (!currentSelection.length) {
            return {
                updatedSelection: [],
                feedbackText: '⚠️ A seleção atual está vazia. Use um comando de adicionar para incluir membros.',
            };
        }

        const targetsRaw = text.replace(/^(remover|tirar|tira|remove|cancela)\s+/i, '').trim();
        const targetTokens = this.tokenizeAttendanceInput(targetsRaw);

        const updatedMap = new Map<number, { id: number; name: string }>();
        currentSelection.forEach((member) => updatedMap.set(member.id, member));

        const removedNames: string[] = [];
        const unresolvedTokens: string[] = [];
        const ambiguousTokens: Array<{ token: string; candidates: Array<{ id: number; name: string; index: number }> }> = [];

        targetTokens.forEach((token) => {
            const numeric = Number(token);
            if (Number.isInteger(numeric) && numeric >= 1 && numeric <= currentSelection.length) {
                const member = currentSelection[numeric - 1];
                if (updatedMap.delete(member.id)) {
                    removedNames.push(member.name);
                }
                return;
            }

            const normalizedToken = this.normalizeName(token);
            if (!normalizedToken) {
                return;
            }

            const exact = currentSelection.filter((member) => this.normalizeName(member.name) === normalizedToken);
            if (exact.length === 1) {
                if (updatedMap.delete(exact[0].id)) {
                    removedNames.push(exact[0].name);
                }
                return;
            }

            if (exact.length > 1) {
                ambiguousTokens.push({
                    token,
                    candidates: exact.map((candidate) => ({
                        ...candidate,
                        index: currentSelection.findIndex((m) => m.id === candidate.id) + 1,
                    })),
                });
                return;
            }

            const partial = currentSelection.filter((member) => this.matchesTokenAtWordBoundary(this.normalizeName(member.name), normalizedToken));
            if (partial.length === 1) {
                if (updatedMap.delete(partial[0].id)) {
                    removedNames.push(partial[0].name);
                }
                return;
            }

            if (partial.length > 1) {
                ambiguousTokens.push({
                    token,
                    candidates: partial.map((candidate) => ({
                        ...candidate,
                        index: currentSelection.findIndex((m) => m.id === candidate.id) + 1,
                    })),
                });
                return;
            }

            const fuzzy = currentSelection.filter((member) => this.isSmallNameDifference(this.normalizeName(member.name), normalizedToken));
            if (fuzzy.length === 1) {
                if (updatedMap.delete(fuzzy[0].id)) {
                    removedNames.push(fuzzy[0].name);
                }
                return;
            }

            unresolvedTokens.push(token);
        });

        const updatedSelection = Array.from(updatedMap.values());
        let feedback = '';

        if (removedNames.length) {
            feedback += '*Removidos da seleção:*\n';
            removedNames.forEach((name) => {
                feedback += `- ${name}\n`;
            });
            feedback += '\n';
        }

        if (ambiguousTokens.length || unresolvedTokens.length) {
            feedback += this.buildAttendanceParseFeedback({
                selectedMembers: [],
                ambiguousTokens,
                unresolvedTokens,
            });
        }

        if (!feedback.trim()) {
            feedback = '⚠️ Não consegui remover nenhum membro com esse comando.';
        }

        return {
            updatedSelection,
            feedbackText: feedback.trim(),
        };
    }

    // ---------- Scoring and Debug Helpers --------

    private scoreMatchesByPosition(
        candidates: Array<{ id: number; name: string }>,
        normalizedToken: string
    ): Array<{ member: { id: number; name: string }; score: number }> {
        const scored = candidates.map((member) => ({
            member,
            score: this.scoreByPosition(this.normalizeName(member.name), normalizedToken),
        }));

        return scored.sort((a, b) => b.score - a.score);
    }

    private scoreFuzzyMatches(
        candidates: Array<{ id: number; name: string }>,
        normalizedToken: string
    ): Array<{ member: { id: number; name: string }; score: number; distance: number }> {
        const scored = candidates.map((member) => {
            const normalizedMemberName = this.normalizeName(member.name);
            const distance = this.bestFuzzyDistance(normalizedMemberName, normalizedToken);
            const score = this.scoreByPosition(normalizedMemberName, normalizedToken);
            return { member, score, distance };
        });

        return scored.sort((a, b) => {
            if (a.distance !== b.distance) {
                return a.distance - b.distance;
            }
            return b.score - a.score;
        });
    }

    private scoreByPosition(normalizedMemberName: string, normalizedToken: string): number {
        // Base score structure:
        // - Starts with token: 1.5
        // - Token in first 30% of name: 1.3
        // - Token elsewhere: 1.0

        if (!normalizedMemberName || !normalizedToken) {
            return 0;
        }

        const tokenIndex = normalizedMemberName.indexOf(normalizedToken);
        if (tokenIndex === -1) {
            return 0; // Should not happen in this context
        }

        // Perfect match at start (e.g., "Maria" for "Maria Clara")
        if (tokenIndex === 0) {
            return 1.5;
        }

        // Token early in the name (within first 30%)
        const thresholdIndex = Math.floor(normalizedMemberName.length * 0.3);
        if (tokenIndex < thresholdIndex) {
            return 1.3;
        }

        // Token elsewhere in the name
        return 1.0;
    }

    private matchesTokenAtWordBoundary(normalizedMemberName: string, normalizedToken: string): boolean {
        if (!normalizedMemberName || !normalizedToken) {
            return false;
        }

        const words = normalizedMemberName.split(/\s+/).filter(Boolean);
        return words.some((word) => word.startsWith(normalizedToken));
    }

    private findMatchedWordIndex(words: string[], normalizedToken: string, startAt = 0): number {
        for (let index = Math.max(0, startAt); index < words.length; index++) {
            if (words[index].startsWith(normalizedToken)) {
                return index;
            }
        }

        return -1;
    }

    private bestFuzzyDistance(normalizedMemberName: string, normalizedToken: string): number {
        let bestDistance = this.levenshteinDistance(normalizedMemberName, normalizedToken);
        const words = normalizedMemberName.split(/\s+/).filter(Boolean);
        words.forEach((word) => {
            const distance = this.levenshteinDistance(word, normalizedToken);
            if (distance < bestDistance) {
                bestDistance = distance;
            }
        });
        return bestDistance;
    }

    private logDebug(message: string): void {
        if (this.debugParsing) {
            console.log(`[AttendanceParser] ${message}`);
        }
    }

    // ---------- helpers --------

    private buildAttendanceParseFeedback(parseResult: {
        selectedMembers: Array<{ id: number; name: string }>;
        ambiguousTokens: Array<{ token: string; candidates: Array<{ id: number; name: string; index: number }> }>;
        unresolvedTokens: string[];
    }): string {
        let text = '';

        if (parseResult.selectedMembers.length) {
            text += '*Identificados até agora:*\n';
            parseResult.selectedMembers.forEach((member, index) => {
                text += `${index + 1} - ${member.name}\n`;
            });
            text += '\n';
        }

        if (parseResult.ambiguousTokens.length) {
            text += '*Termos ambíguos:*\n';
            parseResult.ambiguousTokens.forEach((item) => {
                text += `- "${item.token}":\n`;
                item.candidates.forEach((candidate) => {
                    text += `  - ${candidate.index}-${candidate.name}\n`;
                });
            });
            text += '\n';
        }

        if (parseResult.unresolvedTokens.length) {
            text += '*Não consegui encontrar:*\n';
            parseResult.unresolvedTokens.forEach((token) => {
                text += `- ${token}\n`;
            });
        }

        return text.trim();
    }

    private normalizeName(value: string): string {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    private isSmallNameDifference(normalizedMemberName: string, normalizedToken: string): boolean {
        if (!normalizedMemberName || !normalizedToken) {
            return false;
        }

        if (Math.abs(normalizedMemberName.length - normalizedToken.length) <= 1
            && this.levenshteinDistance(normalizedMemberName, normalizedToken) <= 1) {
            return true;
        }

        const words = normalizedMemberName.split(/\s+/).filter(Boolean);
        return words.some((word) => Math.abs(word.length - normalizedToken.length) <= 1
            && this.levenshteinDistance(word, normalizedToken) <= 1);
    }

    private levenshteinDistance(a: string, b: string): number {
        const rows = a.length + 1;
        const cols = b.length + 1;
        const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

        for (let i = 0; i < rows; i++) {
            dp[i][0] = i;
        }
        for (let j = 0; j < cols; j++) {
            dp[0][j] = j;
        }

        for (let i = 1; i < rows; i++) {
            for (let j = 1; j < cols; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }

        return dp[a.length][b.length];
    }

    private formatWeekPeriodLabel(week: any): string {
        if (typeof week?.period === 'string' && week.period.trim()) {
            return week.period;
        }

        if (typeof week?.isoDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week.isoDate)) {
            const [year, month, day] = week.isoDate.split('-');
            return `${day}/${month}/${year}`;
        }

        return 'Data não informada';
    }

}
