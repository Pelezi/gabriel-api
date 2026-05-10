import axios from 'axios';

import { ActionDescriptor, ProjectAdapter } from './project-adapter.interface';

export abstract class BaseHttpProjectAdapter implements ProjectAdapter {

    public abstract readonly adapterKey: string;

    public abstract supportsProject(project: any): boolean;

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

        const response = await axios.get(fullUrl, {
            params: { phone: phoneNumber },
            timeout: 5000,
            headers,
        });

        return response.data === true || response.data?.exists === true;
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
