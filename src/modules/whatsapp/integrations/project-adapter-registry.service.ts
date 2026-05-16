import { Injectable } from '@nestjs/common';

import { DefaultProjectAdapter } from './adapters/default-project.adapter';
import { ActionDescriptor, ProjectAdapter } from './adapters/project-adapter.interface';
import { TalentosProjectAdapter } from './adapters/talentos-project.adapter';
import { UvasProjectAdapter } from './adapters/uvas-project.adapter';

@Injectable()
export class ProjectAdapterRegistryService {

    private readonly adapters: ProjectAdapter[];

    public constructor(
        private readonly uvasProjectAdapter: UvasProjectAdapter,
        private readonly talentosProjectAdapter: TalentosProjectAdapter,
        private readonly defaultProjectAdapter: DefaultProjectAdapter
    ) {
        this.adapters = [
            this.uvasProjectAdapter,
            this.talentosProjectAdapter,
            this.defaultProjectAdapter,
        ];
    }

    public resolveAdapter(project: any): ProjectAdapter {
        return this.adapters.find((adapter) => adapter.supportsProject(project)) || this.defaultProjectAdapter;
    }

    public async verifyMembership(project: any, phoneNumber: string): Promise<boolean> {
        const adapter = this.resolveAdapter(project);
        return adapter.verifyMembership(project, phoneNumber);
    }

    public async executeAction(project: any, actionKey: string, payload: any, authContext?: any): Promise<any> {
        const adapter = this.resolveAdapter(project);
        return adapter.executeAction(project, actionKey, payload, authContext);
    }

    public listAvailableActions(project: any): ActionDescriptor[] {
        const adapter = this.resolveAdapter(project);
        return adapter.listAvailableActions(project);
    }

    public async listAvailableActionsForContact(project: any, phoneNumber: string): Promise<ActionDescriptor[]> {
        const actions = this.listAvailableActions(project);
        const adapter = this.resolveAdapter(project) as any;
        const hasLandingAction = actions.some((action) => action.actionKey === 'uvas_landing_page');

        if (!hasLandingAction) {
            return actions;
        }

        // Novo padrão: para Uvas, a regra da landing no menu raiz deve usar check-phone
        // (exists + permissões por matrix). Mantemos fallback para adapters legados.
        if (adapter.getPhoneCheckData) {
            const checkPhoneData = await this.getPhoneCheckData(project, phoneNumber);
            const matrices = Array.isArray(checkPhoneData?.matrices) ? checkPhoneData.matrices : [];
            const canAccessLanding = !!checkPhoneData?.exists
                && matrices.some((matrix) => !!matrix?.canManageMagazines || !!matrix?.canManageAnnouncements);

            return canAccessLanding
                ? actions
                : actions.filter((action) => action.actionKey !== 'uvas_landing_page');
        }

        if (!adapter.getMemberPermissions) {
            return actions;
        }

        const permissions = await this.getMemberPermissions(project, phoneNumber);
        const canAccessLanding = !!permissions?.canManageMagazines || !!permissions?.canManageAnnouncements;

        if (canAccessLanding) {
            return actions;
        }

        return actions.filter((action) => action.actionKey !== 'uvas_landing_page');
    }

    public async getMemberPermissions(
        project: any,
        phoneNumber: string
    ): Promise<{ canManageMagazines: boolean; canManageAnnouncements: boolean }> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getMemberPermissions) {
            return adapter.getMemberPermissions(project, phoneNumber);
        }

        return { canManageMagazines: false, canManageAnnouncements: false };
    }

    public async getPhoneCheckData(
        project: any,
        phoneNumber: string
    ): Promise<{
        exists: boolean;
        matrices: Array<{ id: number; name: string; canManageMagazines: boolean; canManageAnnouncements: boolean }>;
    }> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getPhoneCheckData) {
            return adapter.getPhoneCheckData(project, phoneNumber);
        }

        return { exists: false, matrices: [] };
    }

    public async getLeaderCells(project: any, phoneNumber: string): Promise<{
        cells: Array<{ id: number; name: string }>;
        permissions: { canManageMagazines: boolean; canManageAnnouncements: boolean };
        matrices: Array<{ id: number; name: string }>;
    }> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getLeaderCells) {
            return adapter.getLeaderCells(project, phoneNumber);
        }
        return { cells: [], permissions: { canManageMagazines: false, canManageAnnouncements: false }, matrices: [] };
    }

    public async getReportStatus(project: any, cellId: number, reportType?: 'culto' | 'celula'): Promise<any> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getReportStatus) {
            return adapter.getReportStatus(project, cellId, reportType);
        }
        return null;
    }

    public async getCellMembers(project: any, cellId: number): Promise<Array<{ id: number; name: string }>> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getCellMembers) {
            return adapter.getCellMembers(project, cellId);
        }
        return [];
    }

    public async getExistingReport(
        project: any,
        cellId: number,
        date: string,
        reportType: 'culto' | 'celula'
    ): Promise<any | null> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getExistingReport) {
            return adapter.getExistingReport(project, cellId, date, reportType);
        }
        return null;
    }

    public async submitReport(
        project: any,
        cellId: number,
        reportType: 'culto' | 'celula',
        weekId: string,
        members: Array<{ id: number; name: string }>,
        extras?: { visitantes?: number; oferta?: number; entrega?: string }
    ): Promise<{ success: boolean; message: string }> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.submitReport) {
            return adapter.submitReport(project, cellId, reportType, weekId, members, extras);
        }
        return { success: false, message: 'Adapter não suporta envio de relatório.' };
    }

    public async getLandingMagazineStatus(project: any, phoneNumber: string, matrixId?: number): Promise<any> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getLandingMagazineStatus) {
            return adapter.getLandingMagazineStatus(project, phoneNumber, matrixId);
        }

        return { weeks: [] };
    }

    public async uploadLandingMagazine(
        project: any,
        phoneNumber: string,
        payload: {
            weekStartDate: string;
            fileBuffer: Buffer;
            fileName: string;
            mimeType: string;
            matrixId?: number;
            replaceExisting?: boolean;
        }
    ): Promise<{ success: boolean; replaced?: boolean; message: string; data?: any; statusCode?: number }> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.uploadLandingMagazine) {
            return adapter.uploadLandingMagazine(project, phoneNumber, payload);
        }

        return { success: false, message: 'Adapter não suporta upload de revista da landing.' };
    }

    public async getActiveLandingAnnouncements(project: any, phoneNumber: string, matrixId?: number): Promise<any[]> {
        const adapter = this.resolveAdapter(project) as any;
        if (adapter.getActiveLandingAnnouncements) {
            return adapter.getActiveLandingAnnouncements(project, phoneNumber, matrixId);
        }

        return [];
    }

}
