import { Injectable } from '@nestjs/common';

import { BaseHttpProjectAdapter } from './base-http-project.adapter';

@Injectable()
export class DefaultProjectAdapter extends BaseHttpProjectAdapter {

    public readonly adapterKey = 'default';

    public supportsProject(_project: any): boolean {
        return true;
    }

}
