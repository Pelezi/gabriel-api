import { Injectable } from '@nestjs/common';

import { BaseHttpProjectAdapter } from './base-http-project.adapter';
import { ActionDescriptor } from './project-adapter.interface';

@Injectable()
export class TalentosProjectAdapter extends BaseHttpProjectAdapter {

    public readonly adapterKey = 'talentos';

    public supportsProject(project: any): boolean {
        const name = String(project?.name || '').toLowerCase();
        return name.includes('talentos');
    }

    public listAvailableActions(_project: any): ActionDescriptor[] {
        return [
            { actionKey: 'talentos_new_transaction', label: 'Criar nova transação' },
        ];
    }

}
