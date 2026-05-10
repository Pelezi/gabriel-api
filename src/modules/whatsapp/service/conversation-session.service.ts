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
