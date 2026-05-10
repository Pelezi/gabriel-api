import { Injectable } from '@nestjs/common';

import { ProjectAdapterRegistryService } from '../integrations';
import { PrismaService } from '../../common';
import { MessagePersistenceService } from './message-persistence.service';
import { OutboundMessengerService } from './outbound-messenger.service';
import { ConversationSessionService } from './conversation-session.service';

@Injectable()
export class ProjectContextService {

    private readonly projectCheckLocks = new Map<string, Promise<number[]>>();
    private readonly projectCheckCache = new Map<string, { projectIds: number[]; timestamp: number }>();

    public constructor(
        private readonly prisma: PrismaService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly messagePersistence: MessagePersistenceService,
        private readonly sessionService: ConversationSessionService,
        private readonly projectAdapterRegistry: ProjectAdapterRegistryService
    ) {}

    public async checkContactInProjectsWithCache(phoneNumber: string): Promise<number[]> {
        const cached = this.projectCheckCache.get(phoneNumber);
        const CACHE_TTL = 5 * 60 * 1000;

        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            console.log(`Using cached project check for ${phoneNumber}`);
            return cached.projectIds;
        }

        const existingCheck = this.projectCheckLocks.get(phoneNumber);
        if (existingCheck) {
            console.log(`Waiting for existing project check for ${phoneNumber}`);
            return existingCheck;
        }

        const checkPromise = this.checkContactInProjects(phoneNumber);
        this.projectCheckLocks.set(phoneNumber, checkPromise);

        try {
            const projectIds = await checkPromise;

            this.projectCheckCache.set(phoneNumber, {
                projectIds,
                timestamp: Date.now(),
            });

            return projectIds;
        } finally {
            setTimeout(() => this.projectCheckLocks.delete(phoneNumber), 5000);
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
