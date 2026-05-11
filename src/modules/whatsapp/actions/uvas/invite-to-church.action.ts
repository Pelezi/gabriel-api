import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common';
import { $Enums } from '../../../../generated/prisma/client';
import { ContactResolverService } from '../../service/contact-resolver.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { InviteToChurchPayload } from './uvas-action.types';

@Injectable()
export class UvasInviteToChurchAction {

    public constructor(
        private readonly prisma: PrismaService,
        private readonly contactResolverService: ContactResolverService,
        private readonly outboundMessenger: OutboundMessengerService
    ) {}

    public async execute(payload: InviteToChurchPayload): Promise<any> {
        const { to, name, platform, platformUrl, login, password, projectId } = payload;

        try {
            const components = [
                {
                    type: 'header',
                    parameters: [
                        {
                            type: 'text',
                            parameter_name: 'name',
                            text: name,
                        },
                    ],
                },
                {
                    type: 'body',
                    parameters: [
                        {
                            type: 'text',
                            parameter_name: 'platform',
                            text: platform,
                        },
                        {
                            type: 'text',
                            parameter_name: 'platform_url',
                            text: platformUrl,
                        },
                        {
                            type: 'text',
                            parameter_name: 'login',
                            text: login,
                        },
                        {
                            type: 'text',
                            parameter_name: 'password',
                            text: password,
                        },
                    ],
                },
            ];

            const response = await this.outboundMessenger.sendTemplateMessage(
                to,
                'access_created',
                'en',
                components
            );

            const messageText = `Bem vindo ${name}
                Olá, seu acesso à plataforma ${platform} foi criado.
                Você pode estar acessando através desse link:
                ${platformUrl}
                Com o seguinte acesso:
                ${login}
                Senha: ${password}

                Por favor mude a sua senha após o primeiro acesso.
                Plataforma feita por Alessandro Cardoso`;

            const dbContact = await this.contactResolverService.upsertContactSafely(
                to,
                {
                    customName: name,
                    ...(projectId && { projectId }),
                },
                {
                    customName: name,
                    ...(projectId && { projectId }),
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
                    textBody: messageText,
                    templateHeader: `Bem vindo ${name}`,
                    templateFooter: 'Plataforma feita por Alessandro Cardoso',
                    status: $Enums.MessageStatus.SENT,
                    sentAt: new Date(),
                },
            });

            return response;
        } catch (error) {
            console.log('Error sending invite to church:', error);
            throw new HttpException('Error sending invite', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

}
