import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { UploadAnnouncementPayload } from './uvas-action.types';

@Injectable()
export class UvasUploadAnnouncementAction {

    public async execute(_payload: UploadAnnouncementPayload): Promise<any> {
        throw new HttpException(
            'UVAS upload announcement action not implemented yet',
            HttpStatus.NOT_IMPLEMENTED
        );
    }

}
