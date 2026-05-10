import axios from 'axios';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

export class WhatsAppApiHelper {
  private phoneNumberId: string;
  private accessToken: string;

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
  }

  /**
   * Download media file from WhatsApp
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    try {
      // Step 1: Get media URL
      const urlResponse = await axios.get(
        `${WHATSAPP_API_URL}/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      );

      const mediaUrl = urlResponse.data.url;

      // Step 2: Download media file
      const fileResponse = await axios.get(mediaUrl, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        responseType: 'arraybuffer',
      });

      return Buffer.from(fileResponse.data);
    } catch (error) {
      console.error('Error downloading media:', error);
      throw error;
    }
  }

  /**
   * Send text message via WhatsApp
   */
  async sendTextMessage(to: string, text: string, replyToMessageId?: string): Promise<any> {
    const url = `${WHATSAPP_API_URL}/${this.phoneNumberId}/messages`;

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    };

    if (replyToMessageId) {
      payload.context = {
        message_id: replyToMessageId,
      };
    }

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }

  /**
   * Send media message via WhatsApp
   */
  async sendMediaMessage(
    to: string,
    type: 'image' | 'video' | 'audio' | 'document',
    mediaLink: string,
    caption?: string,
    filename?: string
  ): Promise<any> {
    const url = `${WHATSAPP_API_URL}/${this.phoneNumberId}/messages`;

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
    };

    payload[type] = {
      link: mediaLink,
    };

    if (caption) {
      payload[type].caption = caption;
    }

    if (filename && type === 'document') {
      payload[type].filename = filename;
    }

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }

  /**
   * Send template message via WhatsApp
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    components: any[]
  ): Promise<any> {
    const url = `${WHATSAPP_API_URL}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components,
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }
}
