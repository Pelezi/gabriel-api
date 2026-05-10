import { Injectable } from '@nestjs/common';

import { DefaultProjectAdapter } from './adapters/default-project.adapter';
import { ProjectAdapter } from './adapters/project-adapter.interface';
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

}
