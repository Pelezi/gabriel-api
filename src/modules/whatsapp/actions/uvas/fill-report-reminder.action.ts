import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common';
import { $Enums } from '../../../../generated/prisma/client';
import { ContactResolverService } from '../../service/contact-resolver.service';
import { OutboundMessengerService } from '../../service/outbound-messenger.service';
import { FillReportReminderPayload } from './uvas-action.types';

@Injectable()
export class UvasFillReportReminderAction {

    public constructor(
        private readonly prisma: PrismaService,
        private readonly contactResolverService: ContactResolverService,
        private readonly outboundMessenger: OutboundMessengerService
    ) {}

    public async execute(payload: FillReportReminderPayload): Promise<any> {
        const { to, templateName, leaderName, cellName, weekPeriod, projectId } = payload;

        try {
            const components = [
                {
                    type: 'body',
                    parameters: [
                        {
                            type: 'text',
                            parameter_name: 'nome_lider',
                            text: leaderName,
                        },
                        {
                            type: 'text',
                            parameter_name: 'nome_celula',
                            text: cellName,
                        },
                        {
                            type: 'text',
                            parameter_name: 'periodo_semana',
                            text: weekPeriod,
                        },
                    ],
                },
            ];

            const response = await this.outboundMessenger.sendTemplateMessage(
                to,
                templateName,
                'pt_BR',
                components
            );

            const templateHeader = templateName === 'report_celula'
                ? 'Relatorio da celula no culto'
                : 'Relatorio da celula';

            const messageText = templateName === 'report_celula'
                ? `Relatorio da celula no culto\nGraca e Paz, ${leaderName}. Passando pra lembrar do relatorio de presenca no culto da celula ${cellName} referente a ${weekPeriod}.\nSe quiser preencher por aqui mesmo ou realizar outra acao, aperte um dos botoes abaixo.`
                : `Relatorio da celula\nGraca e Paz, ${leaderName}. Passando pra lembrar do relatorio da celula ${cellName} referente a ${weekPeriod}.\nSe quiser preencher por aqui mesmo ou realizar outra acao, aperte um dos botoes abaixo.`;

            const existingContact = await this.contactResolverService.findByWaIdVariants(to);
            const dbContact = await this.contactResolverService.upsertContactSafely(
                to,
                {
                    customName: leaderName,
                    projectId: projectId || null,
                },
                {
                    customName: existingContact?.customName || leaderName,
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
                    textBody: messageText,
                    templateHeader,
                    status: $Enums.MessageStatus.SENT,
                    sentAt: new Date(),
                },
            });

            return response;
        } catch (error) {
            console.log('Error sending fill report reminder:', error);
            throw new HttpException('Error sending fill report reminder', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

}
