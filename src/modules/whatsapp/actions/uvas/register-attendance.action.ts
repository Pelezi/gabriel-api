import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { RegisterAttendancePayload } from './uvas-action.types';

@Injectable()
export class UvasRegisterAttendanceAction {

    public async execute(_payload: RegisterAttendancePayload): Promise<any> {
        throw new HttpException(
            'UVAS register attendance action not implemented yet',
            HttpStatus.NOT_IMPLEMENTED
        );
    }

}
