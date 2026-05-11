import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common';
import { $Enums } from '../../../../generated/prisma/client';
import { ContactResolverService } from '../../service/contact-resolver.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { PasswordResetPayload } from './uvas-action.types';

@Injectable()
export class UvasPasswordResetAction {

    public constructor(
        private readonly prisma: PrismaService,
        private readonly contactResolverService: ContactResolverService,
        private readonly outboundMessenger: OutboundMessengerService
    ) {}

    public async execute(payload: PasswordResetPayload): Promise<any> {
        const { to, name, platformName, passwordResetUrl, projectId } = payload;

        try {
            const components = [
                {
                    type: 'header',
                    parameters: [
                        {
                            type: 'text',
                            parameter_name: 'platform_name',
                            text: platformName,
                        },
                    ],
                },
                {
                    type: 'body',
                    parameters: [
                        {
                            type: 'text',
                            parameter_name: 'name',
                            text: name,
                        },
                        {
                            type: 'text',
                            parameter_name: 'password_reset_url',
                            text: passwordResetUrl,
                        },
                    ],
                },
            ];

            const response = await this.outboundMessenger.sendTemplateMessage(
                to,
                'password_reset_url',
                'pt_BR',
                components
            );

            const messageText = `Olá ${name}
Segue o link para redefinição de senha da sua conta:
${passwordResetUrl}
Se você não solicitou redefinição de senha, desconsidere essa mensagem.`;

            const persistedMessageText = messageText.replace(passwordResetUrl, '[REDACTED_URL]');

            const existingContact = await this.contactResolverService.findByWaIdVariants(to);
            const dbContact = await this.contactResolverService.upsertContactSafely(
                to,
                {
                    name,
                    customName: name,
                    projectId: projectId || null,
                },
                {
                    customName: name,
                    projectId: existingContact?.projectId || projectId || null,
                }
            );

            const conversation = await this.prisma.conversation.upsert({
                where: { contactId: dbContact.id },
                update: {},
                create: {
                    contactId: dbContact.id,
                    unreadCount: 0,
                },
            });

            const messageId = response.messages[0].id;
            await this.prisma.message.create({
                data: {
                    id: messageId,
                    conversationId: conversation.id,
                    contactId: dbContact.id,
                    type: $Enums.MessageType.TEXT,
                    direction: $Enums.Direction.OUTBOUND,
                    timestamp: BigInt(Date.now()),
                    textBody: persistedMessageText,
                    templateHeader: `Redefinição de senha ${platformName}`,
                    templateFooter: 'Plataforma feita por Alessandro Cardoso',
                    status: $Enums.MessageStatus.SENT,
                    sentAt: new Date(),
                },
            });

            return response;
        } catch (error) {
            console.log('Error sending password reset:', error);
            throw new HttpException('Error sending password reset', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

}
