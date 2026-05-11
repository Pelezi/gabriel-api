import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { UploadMagazinePayload } from './uvas-action.types';

@Injectable()
export class UvasUploadMagazineAction {

    public async execute(_payload: UploadMagazinePayload): Promise<any> {
        throw new HttpException(
            'UVAS upload magazine action not implemented yet',
            HttpStatus.NOT_IMPLEMENTED
        );
    }

}
