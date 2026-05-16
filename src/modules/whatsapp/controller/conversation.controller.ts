import { Controller, Get, Post, Patch, Param, Body, HttpStatus, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiSecurity, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { WhatsappService } from '../service';
import { ApiKeyOrJwtGuard, ApiKeyOrJwtRequest } from '../../common/security';
import { FillReportReminderBodyDto, InviteToChurchBodyDto, PasswordResetBodyDto } from '../model';

@Controller('conversations')
@ApiTags('conversations')
@UseGuards(ApiKeyOrJwtGuard)
@ApiSecurity('api-key')
@ApiBearerAuth()
export class ConversationController {

    public constructor(
        private readonly whatsappService: WhatsappService
    ) { }

    @Get()
    @ApiOperation({ 
        summary: 'Get all conversations',
        description: 'Retrieves all conversations with the last message for each'
    })
    @ApiResponse({ status: HttpStatus.OK, description: 'Conversations retrieved successfully' })
    public async getConversations(): Promise<any> {
        return this.whatsappService.getConversations();
    }

    @Get(':id/messages')
    @ApiOperation({ 
        summary: 'Get messages for a conversation',
        description: 'Retrieves all messages for a specific conversation'
    })
    @ApiParam({ name: 'id', description: 'Conversation ID' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Messages retrieved successfully' })
    public async getMessages(@Param('id') conversationId: string): Promise<any> {
        return this.whatsappService.getMessages(conversationId);
    }

    @Post(':id/messages')
    @ApiOperation({ 
        summary: 'Send a message',
        description: 'Sends a text message in a conversation'
    })
    @ApiParam({ name: 'id', description: 'Conversation ID' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Message sent successfully' })
    public async sendMessage(
        @Param('id') conversationId: string,
        @Body() body: { text: string; replyToId?: string }
    ): Promise<any> {
        return this.whatsappService.sendTextMessage(conversationId, body.text, body.replyToId);
    }

    @Post('inviteToChurch')
    @ApiOperation({ 
        summary: 'Send invite to church template',
        description: 'Sends an access_created template message to invite someone to church platform'
    })
    @ApiBody({ type: InviteToChurchBodyDto })
    @ApiResponse({ status: HttpStatus.OK, description: 'Invite sent successfully' })
    public async inviteToChurch(
        @Req() request: ApiKeyOrJwtRequest,
        @Body(new ValidationPipe({ whitelist: true, transform: true })) body: InviteToChurchBodyDto
    ): Promise<any> {
        const projectId = request.project?.id;

        return this.whatsappService.inviteToChurch(
            body.to,
            body.name,
            body.platform,
            body.platformUrl,
            body.login,
            body.password,
            projectId
        );
    }

    @Post('passwordReset')
    @ApiOperation({ 
        summary: 'Send password reset template',
        description: 'Sends a password_reset_url template message for password reset'
    })
    @ApiBody({ type: PasswordResetBodyDto })
    @ApiResponse({ status: HttpStatus.OK, description: 'Password reset message sent successfully' })
    public async passwordReset(
        @Req() request: ApiKeyOrJwtRequest,
        @Body(new ValidationPipe({ whitelist: true, transform: true })) body: PasswordResetBodyDto
    ): Promise<any> {
        const projectId = request.project?.id;
        return this.whatsappService.passwordReset(
            body.to,
            body.name,
            body.platformName,
            body.passwordResetUrl,
            projectId
        );
    }

    @Post('reportCelulaReminder')
    @ApiOperation({
        summary: 'Send culto attendance report reminder template',
        description: 'Sends the report_celula template message'
    })
    @ApiBody({ type: FillReportReminderBodyDto })
    @ApiResponse({ status: HttpStatus.OK, description: 'Report reminder message sent successfully' })
    public async reportCelulaReminder(
        @Req() request: ApiKeyOrJwtRequest,
        @Body(new ValidationPipe({ whitelist: true, transform: true })) body: FillReportReminderBodyDto
    ): Promise<any> {
        const projectId = request.project?.id;

        return this.whatsappService.fillReportReminder(
            body.to,
            'report_celula',
            body.leaderName,
            body.cellName,
            body.weekPeriod,
            projectId
        );
    }

    @Post('reportServiceReminder')
    @ApiOperation({
        summary: 'Send cell report reminder template',
        description: 'Sends the report_service template message'
    })
    @ApiBody({ type: FillReportReminderBodyDto })
    @ApiResponse({ status: HttpStatus.OK, description: 'Service report reminder message sent successfully' })
    public async reportServiceReminder(
        @Req() request: ApiKeyOrJwtRequest,
        @Body(new ValidationPipe({ whitelist: true, transform: true })) body: FillReportReminderBodyDto
    ): Promise<any> {
        const projectId = request.project?.id;

        return this.whatsappService.fillReportReminder(
            body.to,
            'report_service',
            body.leaderName,
            body.cellName,
            body.weekPeriod,
            projectId
        );
    }

    @Patch(':id/custom-name')
    @ApiOperation({ 
        summary: 'Update contact custom name',
        description: 'Updates the custom display name for a contact'
    })
    @ApiParam({ name: 'id', description: 'Contact ID' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Custom name updated successfully' })
    public async updateCustomName(
        @Param('id') contactId: string,
        @Body() body: { customName: string }
    ): Promise<any> {
        return this.whatsappService.updateContactCustomName(contactId, body.customName);
    }

}
