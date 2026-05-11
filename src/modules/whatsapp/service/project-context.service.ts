import { Injectable } from '@nestjs/common';

import { ProjectAdapterRegistryService } from '../integrations';
import { PrismaService } from '../../common';
import { RedisCache } from '../../common/provider/redis-cache.provider';
import { RedisLock } from '../../common/provider/redis-lock.provider';
import { MessagePersistenceService } from './message-persistence.service';
import { OutboundMessengerService } from './outbound-messenger.service';
import { ConversationSessionService } from './conversation-session.service';

@Injectable()
export class ProjectContextService {

    public constructor(
        private readonly prisma: PrismaService,
        private readonly redisCache: RedisCache,
        private readonly redisLock: RedisLock,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService,
        private readonly sessionService: ConversationSessionService,
        private readonly projectAdapterRegistry: ProjectAdapterRegistryService
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
                return;
            }

            if (projectIds.length === 1) {
                await this.sessionService.setActiveProject(contact.id, projectIds[0]);

                const detectedProject = await this.prisma.project.findUnique({
                    where: { id: projectIds[0] },
                });

                if (detectedProject && conversationId) {
                    const detectedText = `✅ Número encontrado! Você foi detectado no projeto: *${detectedProject.name}*`;
                    const detectedMsg = await this.outboundMessenger.sendTextMessage(contact.waId, detectedText);
                    await this.messagePersistence.saveOutboundMessage(conversationId, contact.id, detectedText, detectedMsg?.messages?.[0]?.id);
                }

                return;
            }

            const projects = await this.prisma.project.findMany({
                where: { id: { in: projectIds } },
            });

            let selectionMessage = '📋 *Múltiplos Projetos Encontrados*\n\n';
            selectionMessage += 'Você está cadastrado nos seguintes projetos:\n\n';
            projects.forEach((project) => {
                selectionMessage += `*${project.id}* - ${project.name}\n`;
            });
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
                        const exists = await this.projectAdapterRegistry.verifyMembership(project, phoneNumber);
                        return { projectId: project.id, exists };
                    } catch (error: any) {
                        console.log(`Error checking project ${project.name}: ${error.message}`);
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
