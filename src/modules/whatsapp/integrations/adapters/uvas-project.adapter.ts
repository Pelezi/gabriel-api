import { Injectable } from '@nestjs/common';

import { BaseHttpProjectAdapter } from './base-http-project.adapter';

@Injectable()
export class UvasProjectAdapter extends BaseHttpProjectAdapter {

    public readonly adapterKey = 'uvas';

    public supportsProject(project: any): boolean {
        const name = String(project?.name || '').toLowerCase();
        return name.includes('uvas');
    }

}
