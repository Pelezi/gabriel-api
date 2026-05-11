import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common';

type ContactMutationData = {
    name?: string | null;
    customName?: string | null;
    projectId?: number | null;
};

@Injectable()
export class ContactResolverService {

    public constructor(private readonly prisma: PrismaService) {}

    public normalizeBrWaId(waId: string): string {
        const sanitizedWaId = String(waId || '').trim();

        if (!sanitizedWaId.startsWith('55')) {
            return sanitizedWaId;
        }

        if (sanitizedWaId.length < 12) {
            return sanitizedWaId;
        }

        const areaCode = sanitizedWaId.substring(2, 4);
        const restOfNumber = sanitizedWaId.substring(4);

        if (restOfNumber.length === 8) {
            return `55${areaCode}9${restOfNumber}`;
        }

        return sanitizedWaId;
    }

    public async findByWaIdVariants(waId: string): Promise<any | null> {
        const variants = this.buildWaIdVariants(waId);

        for (const variant of variants) {
            const contact = await this.prisma.contact.findUnique({
                where: { waId: variant },
            });

            if (contact) {
                return contact;
            }
        }

        return null;
    }

    public async upsertContactSafely(
        waId: string,
        createData: ContactMutationData,
        updateData?: ContactMutationData
    ): Promise<any> {
        const normalizedWaId = this.normalizeBrWaId(waId);

        const existingContact = await this.findByWaIdVariants(waId);
        if (existingContact) {
            const dataToUpdate = this.cleanMutationData(updateData ?? createData);
            if (Object.keys(dataToUpdate).length === 0) {
                return existingContact;
            }

            return this.prisma.contact.update({
                where: { id: existingContact.id },
                data: dataToUpdate,
            });
        }

        const dataToCreate = this.cleanMutationData(createData);

        try {
            return await this.prisma.contact.create({
                data: {
                    waId: normalizedWaId,
                    ...dataToCreate,
                },
            });
        } catch (error: any) {
            if (!this.isUniqueViolation(error)) {
                throw error;
            }

            // Another concurrent request created the contact first.
            const concurrentContact = await this.findByWaIdVariants(waId);
            if (!concurrentContact) {
                throw error;
            }

            const dataToUpdate = this.cleanMutationData(updateData ?? createData);
            if (Object.keys(dataToUpdate).length === 0) {
                return concurrentContact;
            }

            return this.prisma.contact.update({
                where: { id: concurrentContact.id },
                data: dataToUpdate,
            });
        }
    }

    private buildWaIdVariants(waId: string): string[] {
        const normalizedWaId = this.normalizeBrWaId(waId);
        const variants = new Set<string>();

        if (normalizedWaId) {
            variants.add(normalizedWaId);
        }

        const sanitizedWaId = String(waId || '').trim();
        if (sanitizedWaId) {
            variants.add(sanitizedWaId);
        }

        if (sanitizedWaId.startsWith('55') && sanitizedWaId.length >= 12) {
            const areaCode = sanitizedWaId.substring(2, 4);
            const restOfNumber = sanitizedWaId.substring(4);

            if (restOfNumber.length === 9 && restOfNumber.startsWith('9')) {
                variants.add(`55${areaCode}${restOfNumber.substring(1)}`);
            }

            if (restOfNumber.length === 8) {
                variants.add(`55${areaCode}9${restOfNumber}`);
            }
        }

        return Array.from(variants);
    }

    private cleanMutationData(data: ContactMutationData): ContactMutationData {
        return Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined)
        ) as ContactMutationData;
    }

    private isUniqueViolation(error: any): boolean {
        return error?.code === 'P2002' || error?.meta?.target?.includes?.('wa_id') || error?.meta?.target?.includes?.('waId');
    }

}
