import { Injectable } from '@nestjs/common';
import axios from 'axios';

import { BaseHttpProjectAdapter } from './base-http-project.adapter';
import { ActionDescriptor } from './project-adapter.interface';

@Injectable()
export class UvasProjectAdapter extends BaseHttpProjectAdapter {

    public readonly adapterKey = 'uvas';

    private logUvasRequest(scope: string, method: 'GET' | 'POST', url: string, details: Record<string, any>): void {
        console.log(`[UvasHttp][${scope}][Request]`, {
            method,
            url,
            ...details,
        });
    }

    private logUvasResponse(scope: string, method: 'GET' | 'POST', url: string, response: any, details: Record<string, any>): void {
        console.log(`[UvasHttp][${scope}][Response]`, {
            method,
            url,
            status: response?.status,
            data: response?.data,
            ...details,
        });
    }

    private logUvasError(scope: string, method: 'GET' | 'POST', url: string, error: any, details: Record<string, any>): void {
        console.log(`[UvasHttp][${scope}][Error]`, {
            method,
            url,
            status: error?.response?.status,
            data: error?.response?.data,
            message: error?.message,
            ...details,
        });
    }

    public supportsProject(project: any): boolean {
        const name = String(project?.name || '').toLowerCase();
        return name.includes('uvas');
    }

    public listAvailableActions(_project: any): ActionDescriptor[] {
        return [
            { actionKey: 'uvas_fill_report', label: 'Preencher relatório' },
            { actionKey: 'uvas_landing_page', label: 'Landing page' },
            { actionKey: 'uvas_contact_admin', label: 'Falar com Alessandro' },
        ];
    }

    public async getPhoneCheckData(
        project: any,
        phoneNumber: string
    ): Promise<{
        exists: boolean;
        matrices: Array<{ id: number; name: string; canManageMagazines: boolean; canManageAnnouncements: boolean }>;
    }> {
        const empty = { exists: false, matrices: [] as Array<{ id: number; name: string; canManageMagazines: boolean; canManageAnnouncements: boolean }> };

        if (!project.apiUrl) {
            return empty;
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/check-phone`;
            const params = { phone: phoneNumber };

            this.logUvasRequest('CheckPhone', 'GET', url, {
                projectId: project?.id,
                projectName: project?.name,
                params,
                headers: this.maskHeaders(headers),
            });

            const response = await axios.get(url, {
                params,
                timeout: 5000,
                headers,
            });

            this.logUvasResponse('CheckPhone', 'GET', url, response, {
                projectId: project?.id,
                projectName: project?.name,
                params,
            });

            const data = response?.data || {};
            const matrices = Array.isArray(data.matrices)
                ? data.matrices.map((m: any) => ({
                    id: Number(m?.id),
                    name: String(m?.name || ''),
                    canManageMagazines: !!m?.canManageMagazines,
                    canManageAnnouncements: !!m?.canManageAnnouncements,
                })).filter((m: any) => Number.isFinite(m.id) && !!m.name)
                : [];

            return {
                exists: data?.exists === true,
                matrices,
            };
        } catch (error: any) {
            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/check-phone`;
            this.logUvasError('CheckPhone', 'GET', url, error, {
                projectId: project?.id,
                projectName: project?.name,
                params: { phone: phoneNumber },
            });
            return empty;
        }
    }

    public async getMemberPermissions(
        project: any,
        phoneNumber: string
    ): Promise<{ canManageMagazines: boolean; canManageAnnouncements: boolean }> {
        const checkPhone = await this.getPhoneCheckData(project, phoneNumber);
        const matrices = Array.isArray(checkPhone?.matrices) ? checkPhone.matrices : [];

        return {
            canManageMagazines: matrices.some((m) => !!m.canManageMagazines),
            canManageAnnouncements: matrices.some((m) => !!m.canManageAnnouncements),
        };
    }

    /**
     * Busca as células associadas a um líder/líder em treinamento pelo número de celular
     */
    public async getLeaderCells(project: any, phoneNumber: string): Promise<{
        cells: Array<{ id: number; name: string }>;
        permissions: { canManageMagazines: boolean; canManageAnnouncements: boolean };
        matrices: Array<{ id: number; name: string }>;
    }> {
        const empty = { cells: [], permissions: { canManageMagazines: false, canManageAnnouncements: false }, matrices: [] };

        if (!project.apiUrl) {
            return empty;
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/leader/cells`;

            const params = { phone: phoneNumber };
            this.logUvasRequest('LeaderCells', 'GET', url, {
                projectId: project?.id,
                projectName: project?.name,
                params,
                headers: this.maskHeaders(headers),
            });

            const response = await axios.get(url, {
                params,
                timeout: 5000,
                headers,
            });

            this.logUvasResponse('LeaderCells', 'GET', url, response, {
                projectId: project?.id,
                projectName: project?.name,
                params,
            });

            const data = response.data || {};
            const parsedResult = {
                cells: Array.isArray(data.cells) ? data.cells : [],
                permissions: data.permissions || { canManageMagazines: false, canManageAnnouncements: false },
                matrices: Array.isArray(data.matrices) ? data.matrices : [],
            };

            console.log('[Uvas][LeaderCells] Parsed matrix payload', {
                projectId: project?.id,
                projectName: project?.name,
                phone: phoneNumber,
                matrixCount: parsedResult.matrices.length,
                matrices: parsedResult.matrices,
                permissions: parsedResult.permissions,
                cellsCount: parsedResult.cells.length,
            });

            return {
                cells: parsedResult.cells,
                permissions: parsedResult.permissions,
                matrices: parsedResult.matrices,
            };
        } catch (error: any) {
            this.logUvasError('LeaderCells', 'GET', `${project.apiUrl.replace(/\/$/, '')}/external/whatsapp/leader/cells`, error, {
                projectId: project?.id,
                projectName: project?.name,
                params: { phone: phoneNumber },
            });
            return empty;
        }
    }

    public async getLandingMagazineStatus(project: any, phoneNumber: string, matrixId?: number): Promise<any> {
        if (!project.apiUrl) {
            return { weeks: [] };
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/landing/magazines/status`;
            const params: Record<string, any> = { phone: phoneNumber, count: 4 };
            if (matrixId) params.matrixId = matrixId;

            this.logUvasRequest('LandingMagazines', 'GET', url, {
                projectId: project?.id,
                projectName: project?.name,
                params,
                headers: this.maskHeaders(headers),
            });

            const response = await axios.get(url, {
                params,
                timeout: 5000,
                headers,
            });

            this.logUvasResponse('LandingMagazines', 'GET', url, response, {
                projectId: project?.id,
                projectName: project?.name,
                params,
            });

            return response.data || { weeks: [] };
        } catch (error: any) {
            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/landing/magazines/status`;
            this.logUvasError('LandingMagazines', 'GET', url, error, {
                projectId: project?.id,
                projectName: project?.name,
                params: { phone: phoneNumber, count: 4, matrixId },
            });
            return { weeks: [] };
        }
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
        if (!project.apiUrl) {
            return { success: false, message: 'API URL não configurada.' };
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/landing/magazines/upload`;

            const formData = new FormData();
            formData.append('phone', phoneNumber);
            formData.append('weekStartDate', payload.weekStartDate);
            if (payload.matrixId) {
                formData.append('matrixId', String(payload.matrixId));
            }
            formData.append('replaceExisting', payload.replaceExisting ? 'true' : 'false');
            formData.append('file', new globalThis.Blob([new Uint8Array(payload.fileBuffer)], { type: payload.mimeType }), payload.fileName);

            this.logUvasRequest('LandingMagazineUpload', 'POST', url, {
                projectId: project?.id,
                projectName: project?.name,
                payload: {
                    phone: phoneNumber,
                    weekStartDate: payload.weekStartDate,
                    matrixId: payload.matrixId,
                    replaceExisting: !!payload.replaceExisting,
                    fileName: payload.fileName,
                    mimeType: payload.mimeType,
                },
                headers: this.maskHeaders(headers),
            });

            const response = await axios.post(url, formData, {
                timeout: 1500000,
                headers,
            });

            this.logUvasResponse('LandingMagazineUpload', 'POST', url, response, {
                projectId: project?.id,
                projectName: project?.name,
            });

            return {
                success: true,
                replaced: !!payload.replaceExisting,
                message: payload.replaceExisting ? 'Revista substituída com sucesso.' : 'Revista enviada com sucesso.',
                data: response.data,
                statusCode: response.status,
            };
        } catch (error: any) {
            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/landing/magazines/upload`;
            this.logUvasError('LandingMagazineUpload', 'POST', url, error, {
                projectId: project?.id,
                projectName: project?.name,
                payload: {
                    phone: phoneNumber,
                    weekStartDate: payload.weekStartDate,
                    matrixId: payload.matrixId,
                    replaceExisting: !!payload.replaceExisting,
                    fileName: payload.fileName,
                    mimeType: payload.mimeType,
                },
            });

            return {
                success: false,
                replaced: !!payload.replaceExisting,
                statusCode: error?.response?.status,
                message: error?.response?.data?.message || error?.message || 'Erro ao enviar revista.',
                data: error?.response?.data,
            };
        }
    }

    public async getActiveLandingAnnouncements(project: any, phoneNumber: string, matrixId?: number): Promise<any[]> {
        if (!project.apiUrl) {
            return [];
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/landing/announcements/active`;
            const params: Record<string, any> = { phone: phoneNumber };
            if (matrixId) params.matrixId = matrixId;

            this.logUvasRequest('LandingAnnouncements', 'GET', url, {
                projectId: project?.id,
                projectName: project?.name,
                params,
                headers: this.maskHeaders(headers),
            });

            const response = await axios.get(url, {
                params,
                timeout: 5000,
                headers,
            });

            this.logUvasResponse('LandingAnnouncements', 'GET', url, response, {
                projectId: project?.id,
                projectName: project?.name,
                params,
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error: any) {
            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/landing/announcements/active`;
            this.logUvasError('LandingAnnouncements', 'GET', url, error, {
                projectId: project?.id,
                projectName: project?.name,
                params: { phone: phoneNumber, matrixId },
            });
            return [];
        }
    }

    /**
     * Busca o status dos relatórios das últimas 4 datas para uma célula, filtrando por tipo
     */
    public async getReportStatus(project: any, cellId: number, reportType?: 'culto' | 'celula'): Promise<any> {
        if (!project.apiUrl) {
            return null;
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/cell/${cellId}/report-status`;
            const normalizedType = reportType === 'culto' ? 'CULTO' : 'CELULA';

            const response = await axios.get(url, {
                params: { reportType: normalizedType },
                timeout: 5000,
                headers,
            });

            return response.data;
        } catch (error) {
            console.log(`Error fetching report status: ${error}`);
            return null;
        }
    }

    public async getCellMembers(project: any, cellId: number): Promise<Array<{ id: number; name: string }>> {
        if (!project.apiUrl || !cellId) {
            return [];
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/cell/${cellId}/members`;

            const response = await axios.get(url, {
                timeout: 5000,
                headers,
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.log(`Error fetching cell members: ${error}`);
            return [];
        }
    }

    public async getExistingReport(
        project: any,
        cellId: number,
        date: string,
        reportType: 'culto' | 'celula'
    ): Promise<any | null> {
        if (!project.apiUrl || !cellId || !date) {
            return null;
        }

        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }

            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/cell/${cellId}/report`;
            const normalizedType = reportType === 'culto' ? 'CULTO' : 'CELULA';

            const response = await axios.get(url, {
                params: { date, reportType: normalizedType },
                timeout: 5000,
                headers,
            });

            return response.data || null;
        } catch (error) {
            console.log(`Error fetching existing report: ${error}`);
            return null;
        }
    }

    /**
     * Envia o relatório preenchido para o Uvas (culto ou célula)
     * 
     * Transforma dados internos Gabriel em formato esperado por Uvas:
     * - reportType → type (maiúscula)
     * - members → memberIds
     * - weekId (isoDate) → date
     * - visitantes → visitorCount
     * - oferta → offerAmount
     * - entrega → offerDeliveryMethod (com mapeamento de valores)
     * - calcula offerDelivered baseado em oferta
     */
    public async submitReport(
        project: any,
        cellId: number,
        reportType: 'culto' | 'celula',
        weekId: string,
        members: Array<{ id: number; name: string }>,
        extras?: { visitantes?: number; oferta?: number; entrega?: string }
    ): Promise<{ success: boolean; message: string }> {
        if (!project.apiUrl) {
            return { success: false, message: 'API URL não configurada.' };
        }
        try {
            const headers: Record<string, string> = {};
            if (project.apiKey) {
                headers['X-API-KEY'] = project.apiKey;
            }
            const baseUrl = project.apiUrl.replace(/\/$/, '');
            const url = `${baseUrl}/external/whatsapp/cell/${cellId}/report`;
            
            // Normalize report type
            const normalizedType = reportType === 'culto' ? 'CULTO' : 'CELULA';
            
            // Map delivery method: gabriel português → uvas english constants
            const mapDeliveryMethod = (entrega: string | undefined | null): string | undefined => {
                if (entrega === 'dinheiro') return 'CASH_TO_DISCIPULADOR';
                if (entrega === 'pix') return 'PIX_TO_VIDEIRA';
                return undefined;
            };
            
            // Build payload in Uvas ReportCreateInput format
            const payload: any = {
                memberIds: members.map(m => m.id),
                type: normalizedType,
                date: weekId, // weekId should already be isoDate format (YYYY-MM-DD)
            };
            
            // Add CELULA-specific fields
            if (normalizedType === 'CELULA' && extras) {
                if (extras.visitantes !== undefined && extras.visitantes > 0) {
                    payload.visitorCount = extras.visitantes;
                }
                if (extras.oferta !== undefined && extras.oferta > 0) {
                    payload.offerAmount = extras.oferta;
                    // offerDelivered is true if offer was made
                    payload.offerDelivered = true;
                    // Map delivery method
                    const deliveryMethod = mapDeliveryMethod(extras.entrega);
                    if (deliveryMethod) {
                        payload.offerDeliveryMethod = deliveryMethod;
                    }
                }
            }
            
            console.log(`Submitting report to ${url} with payload:`, JSON.stringify(payload));
            const response = await axios.post(url, payload, { headers, timeout: 8000 });

            const isSuccess = response.status >= 200 && response.status < 300 && !!response.data;
            if (isSuccess) {
                return { success: true, message: 'Relatório enviado com sucesso!' };
            }

            return { success: false, message: 'Falha ao enviar relatório.' };
        } catch (error: any) {
            const responseMessage = error?.response?.data?.message || error?.response?.data?.error;
            console.log(`Erro ao enviar relatório: ${responseMessage || error}`);
            return { success: false, message: responseMessage || 'Erro ao enviar relatório.' };
        }
    }

}
