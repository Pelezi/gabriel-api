import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class PasswordResetBodyDto {

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
    public platformName: string;

    @ApiProperty({ description: 'Password reset URL' })
    @IsString()
    @IsNotEmpty()
    public passwordResetUrl: string;

}
