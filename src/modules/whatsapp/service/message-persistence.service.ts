import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

import { $Enums } from '../../../generated/prisma/client';
import { PrismaService } from '../../common';
import { AwsService } from '../../common/provider/aws.provider';
import { WhatsAppApiHelper } from '../helpers';

@Injectable()
export class MessagePersistenceService {

    private readonly whatsappApi: WhatsAppApiHelper;

    public constructor(
        private readonly prisma: PrismaService,
        private readonly awsService: AwsService
    ) {
        this.whatsappApi = new WhatsAppApiHelper();
    }

    public async saveIncomingMessage(message: any, conversationId: string, contactId: string): Promise<void> {
        const messageData: any = {
            id: message.id,
            conversationId: conversationId,
            contactId: contactId,
            type: this.mapMessageType(message.type),
            direction: $Enums.Direction.INBOUND,
            timestamp: BigInt(parseInt(message.timestamp) * 1000),
            status: $Enums.MessageStatus.DELIVERED,
        };

        if (message.context?.id) {
            messageData.replyToId = message.context.id;
        }

        switch (message.type) {
            case 'text':
                messageData.textBody = message.text.body;
                break;

            case 'image':
                messageData.caption = message.image.caption;
                messageData.mediaId = message.image.id;
                messageData.mediaMimeType = message.image.mime_type;
                try {
                    messageData.mediaLocalPath = await this.downloadAndSaveMedia(
                        message.image.id,
                        message.image.mime_type,
                        'image'
                    );
                } catch (error: any) {
                    console.log(`Failed to download/upload image media: ${error.message}`);
                    messageData.textBody = `[Erro ao baixar imagem: ${error.message}] ${messageData.caption || ''}`;
                }
                break;

            case 'video':
                messageData.caption = message.video.caption;
                messageData.mediaId = message.video.id;
                messageData.mediaMimeType = message.video.mime_type;
                try {
                    messageData.mediaLocalPath = await this.downloadAndSaveMedia(
                        message.video.id,
                        message.video.mime_type,
                        'video'
                    );
                } catch (error: any) {
                    console.log(`Failed to download/upload video media: ${error.message}`);
                    messageData.textBody = `[Erro ao baixar vídeo: ${error.message}] ${messageData.caption || ''}`;
                }
                break;

            case 'audio':
                messageData.mediaId = message.audio.id;
                messageData.mediaMimeType = message.audio.mime_type;
                messageData.isVoice = message.audio.voice;
                try {
                    messageData.mediaLocalPath = await this.downloadAndSaveMedia(
                        message.audio.id,
                        message.audio.mime_type,
                        'audio'
                    );
                } catch (error: any) {
                    console.log(`Failed to download/upload audio media: ${error.message}`);
                    messageData.textBody = `[Erro ao baixar áudio: ${error.message}]`;
                }
                break;

            case 'sticker':
                messageData.mediaId = message.sticker.id;
                messageData.mediaMimeType = message.sticker.mime_type;
                messageData.isAnimated = message.sticker.animated;
                try {
                    messageData.mediaLocalPath = await this.downloadAndSaveMedia(
                        message.sticker.id,
                        message.sticker.mime_type,
                        'sticker'
                    );
                } catch (error: any) {
                    console.log(`Failed to download/upload sticker media: ${error.message}`);
                    messageData.textBody = `[Erro ao baixar sticker: ${error.message}]`;
                }
                break;

            case 'document':
                messageData.mediaId = message.document.id;
                messageData.mediaMimeType = message.document.mime_type;
                messageData.mediaFilename = message.document.filename;
                try {
                    messageData.mediaLocalPath = await this.downloadAndSaveMedia(
                        message.document.id,
                        message.document.mime_type,
                        'document',
                        message.document.filename
                    );
                } catch (error: any) {
                    console.log(`Failed to download/upload document media: ${error.message}`);
                    messageData.textBody = `[Erro ao baixar documento "${message.document.filename || 'arquivo'}": ${error.message}]`;
                }
                break;

            case 'location':
                messageData.latitude = message.location.latitude;
                messageData.longitude = message.location.longitude;
                break;

            case 'reaction':
                messageData.reactionEmoji = message.reaction.emoji;
                messageData.replyToId = message.reaction.message_id;
                break;

            case 'unsupported':
                break;
        }

        await this.prisma.message.create({ data: messageData });
    }

    public async saveOutboundMessage(conversationId: string, contactId: string, textBody: string, wamid?: string): Promise<void> {
        const messageData: any = {
            id: wamid || `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            conversationId: conversationId,
            contactId: contactId,
            type: $Enums.MessageType.TEXT,
            direction: $Enums.Direction.OUTBOUND,
            timestamp: BigInt(Date.now()),
            status: $Enums.MessageStatus.SENT,
            textBody: textBody,
        };

        await this.prisma.message.create({ data: messageData });
    }

    private async downloadAndSaveMedia(
        mediaId: string,
        mimeType: string,
        mediaType: 'image' | 'video' | 'audio' | 'sticker' | 'document',
        filename?: string
    ): Promise<string> {
        try {
            const buffer = await this.whatsappApi.downloadMedia(mediaId);

            const folderMap = {
                image: 'images',
                video: 'videos',
                audio: 'audio',
                sticker: 'stickers',
                document: 'documents',
            };

            const folder = folderMap[mediaType];
            const extension = mimeType.split('/')[1]?.split(';')[0] || 'bin';
            const s3Key = `whatsapp-media/${folder}/${filename || `${uuidv4()}.${extension}`}`;

            await this.awsService.uploadFile(buffer, s3Key, mimeType);
            return s3Key;
        } catch (error) {
            console.log('Error downloading/uploading media:', error);
            throw new HttpException('Error downloading media', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private mapMessageType(type: string): $Enums.MessageType {
        const typeMap: Record<string, $Enums.MessageType> = {
            text: $Enums.MessageType.TEXT,
            image: $Enums.MessageType.IMAGE,
            video: $Enums.MessageType.VIDEO,
            audio: $Enums.MessageType.AUDIO,
            sticker: $Enums.MessageType.STICKER,
            document: $Enums.MessageType.DOCUMENT,
            location: $Enums.MessageType.LOCATION,
            reaction: $Enums.MessageType.REACTION,
            unsupported: $Enums.MessageType.UNSUPPORTED,
        };

        return typeMap[type] || $Enums.MessageType.UNSUPPORTED;
    }

}
