import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common';
import { $Enums } from '../../../generated/prisma/client';
import { ConversationSessionService } from './conversation-session.service';
import { MessagePersistenceService } from './message-persistence.service';
import { OutboundMessengerService } from './outbound-messenger.service';
import { ProjectContextService } from './project-context.service';

@Injectable()
export class ChatWithOwnerTimeoutService {

    private readonly logger = new Logger(ChatWithOwnerTimeoutService.name);
    private isRunning = false;

    public constructor(
        private readonly prisma: PrismaService,
        private readonly sessionService: ConversationSessionService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService,
        private readonly projectContextService: ProjectContextService
    ) {}

    /**
     * Roda a cada hora para encerrar chats com owner sem mensagem inbound há 23h ou mais.
     */
    @Cron(CronExpression.EVERY_HOUR)
    public async closeInactiveOwnerChats(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn('ChatWithOwnerTimeout scheduler já está em execução, pulando ciclo atual.');
            return;
        }

        this.isRunning = true;
        const startedAtMs = Date.now();
        const thresholdMs = Date.now() - (23 * 60 * 60 * 1000);
        let checkedSessions = 0;
        let closedSessions = 0;

        try {
            const sessions = await this.prisma.conversationSession.findMany({
                where: {
                    state: $Enums.ConversationSessionState.CHAT_WITH_OWNER,
                },
                include: {
                    contact: true,
                },
            });

            checkedSessions = sessions.length;

            for (const session of sessions) {
                const context = (session.contextJson || {}) as any;
                const startedAt = context?.chatWithOwnerStartedAt ? new Date(context.chatWithOwnerStartedAt) : session.updatedAt;

                const lastInbound = await this.prisma.message.findFirst({
                    where: {
                        contactId: session.contactId,
                        direction: 'INBOUND',
                        createdAt: {
                            gte: startedAt,
                        },
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                });

                const referenceTime = lastInbound?.createdAt || startedAt;
                if (referenceTime.getTime() > thresholdMs) {
                    continue;
                }

                await this.sessionService.resetToIdle(session.contactId);

                const conversation = await this.prisma.conversation.findUnique({
                    where: { contactId: session.contactId },
                });

                if (!conversation) {
                    continue;
                }

                const closeText = '🛑 Conversa encerrada por inatividade (23h sem mensagens). Quando quiser, inicie uma nova conversa.';
                const sentClose = await this.outboundMessenger.sendTextMessage(session.contact.waId, closeText);
                await this.messagePersistence.saveOutboundMessage(
                    conversation.id,
                    session.contactId,
                    closeText,
                    sentClose?.messages?.[0]?.id
                );

                const projectId = session.activeProjectId ?? session.contact.projectId;
                if (projectId) {
                    await this.projectContextService.sendProjectMenu(
                        { id: session.contactId, waId: session.contact.waId },
                        projectId,
                        conversation.id
                    );
                }

                closedSessions++;
            }

            const duration = Date.now() - startedAtMs;
            if (closedSessions >= 1) {
                this.logger.log(
                    `Scheduler chat_with_owner concluido em ${duration}ms - ${checkedSessions} sessao(oes) verificadas, ${closedSessions} encerrada(s).`
                );
            }
        } catch (error) {
            this.logger.error('Erro ao encerrar chats inativos com owner', error instanceof Error ? error.stack : undefined);
        } finally {
            this.isRunning = false;
        }
    }
}
