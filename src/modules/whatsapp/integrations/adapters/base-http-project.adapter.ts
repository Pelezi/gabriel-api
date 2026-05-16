import axios from 'axios';

import { ActionDescriptor, ProjectAdapter } from './project-adapter.interface';

export abstract class BaseHttpProjectAdapter implements ProjectAdapter {

    public abstract readonly adapterKey: string;

    public abstract supportsProject(project: any): boolean;

    protected maskHeaders(headers: Record<string, string>): Record<string, string> {
        return Object.entries(headers).reduce((acc, [key, value]) => {
            acc[key] = key.toLowerCase().includes('api-key') ? '***' : value;
            return acc;
        }, {} as Record<string, string>);
    }

    public async verifyMembership(project: any, phoneNumber: string): Promise<boolean> {
        if (!project.apiUrl || !project.userNumbersApiUrl) {
            return false;
        }

        const headers: Record<string, string> = {};
        if (project.apiKey) {
            headers['X-API-KEY'] = project.apiKey;
        }

        const baseUrl = project.apiUrl.replace(/\/$/, '');
        const route = project.userNumbersApiUrl.startsWith('/')
            ? project.userNumbersApiUrl
            : `/${project.userNumbersApiUrl}`;
        const fullUrl = `${baseUrl}${route}`;
        const params = { phone: phoneNumber };

        console.log('[UvasHttp][ProjectSelection][Request]', {
            adapter: this.adapterKey,
            projectId: project?.id,
            projectName: project?.name,
            method: 'GET',
            url: fullUrl,
            params,
            headers: this.maskHeaders(headers),
        });

        try {
            const response = await axios.get(fullUrl, {
                params,
                timeout: 5000,
                headers,
            });

            console.log('[UvasHttp][ProjectSelection][Response]', {
                adapter: this.adapterKey,
                projectId: project?.id,
                projectName: project?.name,
                method: 'GET',
                url: fullUrl,
                status: response.status,
                data: response.data,
            });

            return response.data === true || response.data?.exists === true;
        } catch (error: any) {
            console.log('[UvasHttp][ProjectSelection][Error]', {
                adapter: this.adapterKey,
                projectId: project?.id,
                projectName: project?.name,
                method: 'GET',
                url: fullUrl,
                params,
                status: error?.response?.status,
                data: error?.response?.data,
                message: error?.message,
            });
            throw error;
        }
    }

    public listAvailableActions(_project: any): ActionDescriptor[] {
        return [];
    }

    public async executeAction(_project: any, _actionKey: string, _payload: any, _authContext?: any): Promise<any> {
        return {
            success: false,
            message: `Action execution is not implemented for adapter ${this.adapterKey}.`,
        };
    }

}
