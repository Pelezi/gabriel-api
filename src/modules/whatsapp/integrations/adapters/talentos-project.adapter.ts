import { Injectable } from '@nestjs/common';

import { BaseHttpProjectAdapter } from './base-http-project.adapter';

@Injectable()
export class TalentosProjectAdapter extends BaseHttpProjectAdapter {

    public readonly adapterKey = 'talentos';

    public supportsProject(project: any): boolean {
        const name = String(project?.name || '').toLowerCase();
        return name.includes('talentos');
    }

}
