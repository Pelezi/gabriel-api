import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { FillReportReminderPayload } from './uvas-action.types';

@Injectable()
export class UvasFillReportReminderAction {

    public async execute(_payload: FillReportReminderPayload): Promise<any> {
        throw new HttpException(
            'UVAS fill report reminder action not implemented yet',
            HttpStatus.NOT_IMPLEMENTED
        );
    }

}
