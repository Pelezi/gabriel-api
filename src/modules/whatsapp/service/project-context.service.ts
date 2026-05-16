import { Injectable } from '@nestjs/common';

import { ProjectAdapterRegistryService } from '../integrations';
import { PrismaService } from '../../common';
import { RedisCache } from '../../common/provider/redis-cache.provider';
import { RedisLock } from '../../common/provider/redis-lock.provider';
import { MessagePersistenceService } from './message-persistence.service';
import { OutboundMessengerService } from './outbound-messenger.service';
import { ConversationSessionService } from './conversation-session.service';
import { ContactResolverService } from './contact-resolver.service';

@Injectable()
export class ProjectContextService {

    public constructor(
        private readonly prisma: PrismaService,
        private readonly redisCache: RedisCache,
        private readonly redisLock: RedisLock,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService,
        private readonly sessionService: ConversationSessionService,
        private readonly projectAdapterRegistry: ProjectAdapterRegistryService,
        private readonly contactResolverService: ContactResolverService
    ) {}

    public async checkContactInProjectsWithCache(phoneNumber: string): Promise<number[]> {
        const cacheKey = `project-check:${phoneNumber}`;
        const CACHE_TTL = 5 * 60; // 5 minutes in seconds
        
        // Try to get from cache first
        const cached = await this.redisCache.get<number[]>(cacheKey);
        if (cached) {
            console.log(`Using cached project check for ${phoneNumber}`);
            return cached;
        }

        // Try to acquire lock for this phone number (with 30 second wait)
        const lockKey = `project-check-lock:${phoneNumber}`;
        const lockId = await this.redisLock.waitAndAcquire(lockKey, 30000, 30);

        if (!lockId) {
            console.warn(`Failed to acquire lock for project check of ${phoneNumber}, retrying from cache`);
            const retryCache = await this.redisCache.get<number[]>(cacheKey);
            if (retryCache) {
                return retryCache;
            }
            // Fallback to direct check
            return this.checkContactInProjects(phoneNumber);
        }

        try {
            // Check cache again after acquiring lock (another request might have populated it)
            const doubleCheckCache = await this.redisCache.get<number[]>(cacheKey);
            if (doubleCheckCache) {
                console.log(`Another request populated cache for ${phoneNumber}`);
                return doubleCheckCache;
            }

            // Perform the check
            const projectIds = await this.checkContactInProjects(phoneNumber);

            // Store in cache
            await this.redisCache.set(cacheKey, projectIds, CACHE_TTL);

            return projectIds;
        } finally {
            // Always release the lock
            await this.redisLock.release(lockKey, lockId);
        }
    }

    public async handleProjectSelection(contact: any, projectIds: number[], conversationId?: string): Promise<void> {
        try {
            await this.sessionService.getOrCreateSession(contact.id, contact.projectId ?? null);

            if (projectIds.length === 0) {
                await this.sessionService.clearActiveProject(contact.id);

                if (conversationId) {
                    const noProjectText = [
                        '❌ Desculpe, você não está cadastrado em nenhum projeto no momento.',
                        '',
                        'Se quiser, você pode falar com Alessandro:',
                        '0 - Falar com Alessandro',
                        '',
                        '❌ Digite *cancelar* para sair.'
                    ].join('\n');

                    const sentNoProject = await this.outboundMessenger.sendTextMessage(contact.waId, noProjectText);
                    await this.messagePersistence.saveOutboundMessage(
                        conversationId,
                        contact.id,
                        noProjectText,
                        sentNoProject?.messages?.[0]?.id
                    );

                    await this.sessionService.setAwaitingProjectSelection(contact.id, []);
                }

                return;
            }

            if (projectIds.length === 1) {
                await this.sessionService.setActiveProject(contact.id, projectIds[0]);

                const detectedProject = await this.prisma.project.findUnique({
                    where: { id: projectIds[0] },
                });

                if (detectedProject && conversationId) {
                    const detectedText = `✅ Número encontrado! Você foi encontrado no projeto: *${detectedProject.name}*`;
                    const detectedMsg = await this.outboundMessenger.sendTextMessage(contact.waId, detectedText);
                    await this.messagePersistence.saveOutboundMessage(conversationId, contact.id, detectedText, detectedMsg?.messages?.[0]?.id);

                    await this.sendProjectMenu(contact, projectIds[0], conversationId);
                }

                return;
            }

            const projects = await this.prisma.project.findMany({
                where: { id: { in: projectIds } },
            });

            let selectionMessage = '📋 *Múltiplos Projetos Encontrados*\n\n';
            selectionMessage += 'Você está cadastrado nos seguintes projetos:\n\n';
            projects.sort((a, b) => a.id - b.id).forEach((project) => {
                selectionMessage += `*${project.id}* - ${project.name}\n`;
            });
            selectionMessage += '\n*0* - Falar com Alessandro\n';
            selectionMessage += '\n💬 *Responda com o número* do projeto desejado.';
            selectionMessage += '\n❌ Digite *cancelar* para sair.';

            const sentMessage = await this.outboundMessenger.sendTextMessage(contact.waId, selectionMessage);

            let conversation;
            if (conversationId) {
                conversation = await this.prisma.conversation.findUnique({
                    where: { id: conversationId },
                });
            }

            if (!conversation) {
                conversation = await this.prisma.conversation.upsert({
                    where: { contactId: contact.id },
                    update: {},
                    create: {
                        contactId: contact.id,
                        unreadCount: 0,
                    },
                });
            }

            await this.messagePersistence.saveOutboundMessage(
                conversation.id,
                contact.id,
                selectionMessage,
                sentMessage?.messages?.[0]?.id
            );

            await this.sessionService.setAwaitingProjectSelection(contact.id, projectIds);
        } catch (error) {
            console.log(`Error handling project selection: ${error}`);
        }
    }

    public async sendProjectMenu(contact: { id: string; waId: string }, projectId: number, conversationId: string): Promise<void> {
        const project = await this.prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
            return;
        }

        const actions = await this.projectAdapterRegistry.listAvailableActionsForContact(project, contact.waId);
        if (actions.length === 0) {
            return;
        }

        let menuText = '*O que você gostaria de fazer?*\n\n';
        actions.forEach((action, index) => {
            menuText += `${index + 1} - ${action.label}\n`;
        });
        menuText += '\n❌ Digite *0* para trocar de projeto.';

        const sentMsg = await this.outboundMessenger.sendTextMessage(contact.waId, menuText);
        await this.messagePersistence.saveOutboundMessage(conversationId, contact.id, menuText, sentMsg?.messages?.[0]?.id);

        await this.sessionService.setAwaitingActionSelection(contact.id);
    }

    public async notifyOwnerForAdminContactRequest(): Promise<void> {
        try {
            const ownerUser = await this.prisma.user.findFirst({
                where: {
                    isOwner: true,
                    phone: {
                        not: null,
                    },
                },
                select: {
                    phone: true,
                },
            });

            if (!ownerUser?.phone) {
                console.log('No owner user with phone configured to receive admin contact requests.');
                return;
            }

            const ownerPhone = String(ownerUser.phone).replace(/\D/g, '');
            if (!ownerPhone) {
                console.log('Owner phone is invalid for admin contact request template notification.');
                return;
            }

            const ownerContact = await this.contactResolverService.upsertContactSafely(
                ownerPhone,
                { customName: 'Owner' },
                {}
            );

            const ownerConversation = await this.prisma.conversation.upsert({
                where: { contactId: ownerContact.id },
                update: {},
                create: {
                    contactId: ownerContact.id,
                    unreadCount: 0,
                },
            });

            const ownerAlertText = 'Atenção, alguém solicitou falar com você no gabriel.';
            const sent = await this.outboundMessenger.sendTemplateMessage(
                ownerPhone,
                'nova_mensagem',
                'pt_BR',
                []
            );

            await this.messagePersistence.saveOutboundMessage(
                ownerConversation.id,
                ownerContact.id,
                ownerAlertText,
                sent?.messages?.[0]?.id
            );
        } catch (error) {
            console.log('Error notifying owner for admin contact request:', error);
        }
    }

    private async checkContactInProjects(phoneNumber: string): Promise<number[]> {
        try {
            const projects = await this.prisma.project.findMany({
                where: {
                    AND: [
                        { apiUrl: { not: null } },
                        { userNumbersApiUrl: { not: null } },
                    ],
                },
            });

            console.log(`Checking ${projects.length} projects for phone ${phoneNumber}`);

            const results = await Promise.allSettled(
                projects.map(async (project) => {
                    try {
                        console.log('[UvasHttp][ProjectSelection][Dispatch]', {
                            phoneNumber,
                            projectId: project.id,
                            projectName: project.name,
                            apiUrl: project.apiUrl,
                            userNumbersApiUrl: project.userNumbersApiUrl,
                            payload: { phone: phoneNumber },
                        });

                        const exists = await this.projectAdapterRegistry.verifyMembership(project, phoneNumber);

                        console.log('[UvasHttp][ProjectSelection][Result]', {
                            phoneNumber,
                            projectId: project.id,
                            projectName: project.name,
                            response: { exists },
                        });

                        return { projectId: project.id, exists };
                    } catch (error: any) {
                        console.log(`Error checking project ${project.name}: ${error.message}`);
                        console.log(`Error details: ${error.response?.data || error.stack || error.message}`);
                        console.log(error);
                        return { projectId: project.id, exists: false };
                    }
                })
            );

            const projectIds = results
                .filter((result) => result.status === 'fulfilled' && result.value.exists)
                .map((result) => (result as PromiseFulfilledResult<any>).value.projectId);

            const failures = results.filter((result) => result.status === 'rejected');
            if (failures.length > 0) {
                console.log(`⚠️ ${failures.length}/${projects.length} project checks failed`);
            }

            console.log(`Found ${projectIds.length} matching projects for ${phoneNumber}`);
            return projectIds;
        } catch (error) {
            console.log(`Error checking contact in projects: ${error}`);
            return [];
        }
    }

}
