import { Injectable } from '@nestjs/common';

import { $Enums, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../common';

@Injectable()
export class ConversationSessionService {

    public constructor(private readonly prisma: PrismaService) {}

    public async getSession(contactId: string): Promise<any | null> {
        return this.prisma.conversationSession.findUnique({
            where: { contactId },
        });
    }

    public async getOrCreateSession(contactId: string, initialActiveProjectId?: number | null): Promise<any> {
        return this.prisma.conversationSession.upsert({
            where: { contactId },
            update: {},
            create: {
                contactId,
                activeProjectId: initialActiveProjectId ?? null,
                state: $Enums.ConversationSessionState.IDLE,
            },
        });
    }

    public async clearActiveProject(contactId: string): Promise<any> {
        await this.prisma.contact.update({
            where: { id: contactId },
            data: { projectId: null },
        });

        return this.prisma.conversationSession.update({
            where: { contactId },
            data: {
                activeProjectId: null,
                availableProjectIds: Prisma.DbNull,
                state: $Enums.ConversationSessionState.IDLE,
                currentActionKey: null,
                contextJson: Prisma.DbNull,
                expiresAt: null,
            },
        });
    }

    public async setAwaitingProjectSelection(contactId: string, projectIds: number[]): Promise<any> {
        await this.prisma.contact.update({
            where: { id: contactId },
            data: { projectId: null },
        });

        return this.prisma.conversationSession.update({
            where: { contactId },
            data: {
                activeProjectId: null,
                availableProjectIds: projectIds,
                state: $Enums.ConversationSessionState.AWAITING_PROJECT_SELECTION,
                currentActionKey: null,
                contextJson: Prisma.DbNull,
                expiresAt: null,
            },
        });
    }

    public async setActiveProject(contactId: string, projectId: number): Promise<any> {
        await this.prisma.contact.update({
            where: { id: contactId },
            data: { projectId },
        });

        return this.prisma.conversationSession.update({
            where: { contactId },
            data: {
                activeProjectId: projectId,
                availableProjectIds: Prisma.DbNull,
                state: $Enums.ConversationSessionState.IDLE,
                currentActionKey: null,
                contextJson: Prisma.DbNull,
                expiresAt: null,
            },
        });
    }

    public async cancelProjectSelection(contactId: string): Promise<any> {
        return this.prisma.conversationSession.update({
            where: { contactId },
            data: {
                activeProjectId: null,
                availableProjectIds: Prisma.DbNull,
                state: $Enums.ConversationSessionState.IDLE,
                currentActionKey: null,
                contextJson: Prisma.DbNull,
                expiresAt: null,
            },
        });
    }

    public isAwaitingProjectSelection(session: any): boolean {
        return session?.state === $Enums.ConversationSessionState.AWAITING_PROJECT_SELECTION;
    }

    public async setAwaitingActionSelection(contactId: string): Promise<any> {
        return this.prisma.conversationSession.update({
            where: { contactId },
            data: {
                state: $Enums.ConversationSessionState.AWAITING_ACTION_SELECTION,
                currentActionKey: null,
                contextJson: Prisma.DbNull,
            },
        });
    }

    public isAwaitingActionSelection(session: any): boolean {
        return session?.state === $Enums.ConversationSessionState.AWAITING_ACTION_SELECTION;
    }

    public async setCurrentActionKey(contactId: string, actionKey: string | null): Promise<any> {
        return this.prisma.conversationSession.update({
            where: { contactId },
            data: { currentActionKey: actionKey },
        });
    }

    public async setChatWithOwner(contactId: string): Promise<any> {
        return this.prisma.conversationSession.update({
            where: { contactId },
            data: {
                state: $Enums.ConversationSessionState.CHAT_WITH_OWNER,
                currentActionKey: 'chat_with_owner',
                contextJson: {
                    chatWithOwnerStartedAt: new Date().toISOString(),
                } as any,
            },
        });
    }

    public isChatWithOwner(session: any): boolean {
        return session?.state === $Enums.ConversationSessionState.CHAT_WITH_OWNER || session?.currentActionKey === 'chat_with_owner';
    }

    public async resetToIdle(contactId: string): Promise<any> {
        return this.prisma.conversationSession.update({
            where: { contactId },
            data: {
                state: $Enums.ConversationSessionState.IDLE,
                currentActionKey: null,
                contextJson: Prisma.DbNull,
            },
        });
    }

    public getAvailableProjectIds(session: any): number[] {
        const ids = session?.availableProjectIds;
        if (!Array.isArray(ids)) {
            return [];
        }

        return ids
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value));
    }

}
