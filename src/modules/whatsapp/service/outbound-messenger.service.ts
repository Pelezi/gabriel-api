import { Injectable } from '@nestjs/common';

import { WhatsAppApiHelper } from '../helpers';

@Injectable()
export class OutboundMessengerService {

    private readonly whatsappApi: WhatsAppApiHelper;

    public constructor() {
        this.whatsappApi = new WhatsAppApiHelper();
    }

    public async sendTextMessage(to: string, text: string, replyToMessageId?: string): Promise<any> {
        return this.whatsappApi.sendTextMessage(to, text, replyToMessageId);
    }

    public async sendTemplateMessage(
        to: string,
        templateName: string,
        languageCode: string,
        components: any[]
    ): Promise<any> {
        return this.whatsappApi.sendTemplateMessage(to, templateName, languageCode, components);
    }

}
