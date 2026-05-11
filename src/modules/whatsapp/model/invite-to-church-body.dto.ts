import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class InviteToChurchBodyDto {

    @ApiProperty({ description: 'Recipient phone number' })
    @IsString()
    @IsNotEmpty()
    public to: string;

    @ApiProperty({ description: 'Recipient name' })
    @IsString()
    @IsNotEmpty()
    public name: string;

    @ApiProperty({ description: 'Platform name' })
    @IsString()
    @IsNotEmpty()
    public platform: string;

    @ApiProperty({ description: 'Platform URL' })
    @IsString()
    @IsNotEmpty()
    public platformUrl: string;

    @ApiProperty({ description: 'Login credential' })
    @IsString()
    @IsNotEmpty()
    public login: string;

    @ApiProperty({ description: 'Password credential' })
    @IsString()
    @IsNotEmpty()
    public password: string;

}
