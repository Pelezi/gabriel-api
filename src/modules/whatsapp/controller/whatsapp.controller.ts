import { Controller, Get, Post, Query, Body, Res, HttpStatus, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';

import { WhatsappService } from '../service';

@Controller('webhook')
@ApiTags('whatsapp')
export class WhatsappController {

    public constructor(
        private readonly whatsappService: WhatsappService
    ) { }

    @Get()
    @ApiOperation({ 
        summary: 'WhatsApp webhook verification',
        description: 'Handles WhatsApp webhook verification challenge. This endpoint is called by WhatsApp to verify the webhook URL during setup.'
    })
    @ApiQuery({ name: 'hub.mode', required: false, description: 'Webhook mode' })
    @ApiQuery({ name: 'hub.challenge', required: false, description: 'Challenge string to echo back' })
    @ApiQuery({ name: 'hub.verify_token', required: false, description: 'Verification token' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Webhook verified successfully' })
    @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Invalid verification token' })
    public whatsappWebhook(
        @Query('hub.mode') mode: string,
        @Query('hub.challenge') challenge: string,
        @Query('hub.verify_token') token: string,
        @Res() res: FastifyReply
    ): void {
        const isValid = this.whatsappService.verifyWebhook(mode, token);

        if (!isValid) {
            if (!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
                res.status(HttpStatus.INTERNAL_SERVER_ERROR).send();
            } else {
                res.status(HttpStatus.FORBIDDEN).send();
            }
            return;
        }

        // Per WhatsApp API requirements, we must echo back the challenge string exactly.
        // Sending as text/plain prevents XSS. Challenge is only sent after token verification.
        res.status(HttpStatus.OK).type('text/plain').send(challenge);
    }

    @Post()
    @ApiOperation({ 
        summary: 'WhatsApp webhook receiver',
        description: 'Receives incoming WhatsApp webhook events. This endpoint processes messages and notifications from WhatsApp.'
    })
    @ApiResponse({ status: HttpStatus.OK, description: 'Webhook processed successfully' })
    public async whatsappWebhookPost(
        @Req() req: FastifyRequest,
        @Body() body: any,
        @Res() res: FastifyReply
    ): Promise<void> {
        const signatureHeader = req.headers['x-hub-signature-256'];
        const rawBody = (req as any).rawBody;
        const rawBodyString = typeof rawBody === 'string'
            ? rawBody
            : Buffer.isBuffer(rawBody)
                ? rawBody.toString('utf8')
                : '';

        const isSignatureValid = this.whatsappService.verifyWebhookSignature(signatureHeader, rawBodyString);
        if (!isSignatureValid) {
            res.status(HttpStatus.FORBIDDEN).send('Invalid webhook signature');
            return;
        }

        await this.whatsappService.processWebhookEvent(body);
        res.status(HttpStatus.OK).send('Webhook processed');
    }

}
