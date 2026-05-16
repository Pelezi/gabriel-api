import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class FillReportReminderBodyDto {

    @ApiProperty({ description: 'Recipient phone number' })
    @IsString()
    @IsNotEmpty()
    public to: string;

    @ApiProperty({ description: 'Leader name used in the template' })
    @IsString()
    @IsNotEmpty()
    public leaderName: string;

    @ApiProperty({ description: 'Cell name used in the template' })
    @IsString()
    @IsNotEmpty()
    public cellName: string;

    @ApiProperty({ description: 'Week period used in the template' })
    @IsString()
    @IsNotEmpty()
    public weekPeriod: string;

}
