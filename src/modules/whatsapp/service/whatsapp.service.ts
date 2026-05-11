import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { LoggerService } from '../../common/provider';
import { PrismaService } from '../../common';
import { $Enums } from '../../../generated/prisma/client';
import { NotificationService } from '../../notification';
import { AwsService } from '../../common/provider/aws.provider';
import { RedisCache } from '../../common/provider/redis-cache.provider';
import { MessagePersistenceService } from './message-persistence.service';
import { OutboundMessengerService } from './outbound-messenger.service';
import { ProjectContextService } from './project-context.service';
import { ConversationSessionService } from './conversation-session.service';
import { ActionRouterService } from '../actions';

@Injectable()
export class WhatsappService {

    public constructor(
        @InjectQueue('whatsapp-webhook') private readonly webhookQueue: Queue,
        private readonly logger: LoggerService,
        private readonly prisma: PrismaService,
        private readonly notificationService: NotificationService,
        private readonly awsService: AwsService,
        private readonly redisCache: RedisCache,

        private readonly messagePersistence: MessagePersistenceService,
        private readonly outboundMessenger: OutboundMessengerService,
        private readonly projectContextService: ProjectContextService,
        private readonly sessionService: ConversationSessionService,
        private readonly actionRouterService: ActionRouterService
    ) {}

    /**
     * Find contact with Brazilian number variations (with/without the 9th digit)
     * Brazilian mobile numbers: 55 (country) + 11 (area code) + 9XXXXXXXX or 8XXXXXXXX
     * 
     * @param waId WhatsApp ID to search for
     * @returns Contact if found, null otherwise
     */
    private async findContactWithBrVariations(waId: string): Promise<any | null> {
        // First, try to find the exact match
        let contact = await this.prisma.contact.findUnique({
            where: { waId },
        });

        if (contact) {
            return contact;
        }

        // Check if it's a Brazilian number (starts with 55)
        if (!waId.startsWith('55')) {
            return null;
        }

        // Generate the alternative number
        // Brazilian mobile numbers: 55 + area code (2 digits) + number (8 or 9 digits)
        // Format: 55 11 9XXXXXXXX (with 9) or 55 11 8XXXXXXXX (without 9)
        let alternativeNumber: string;

        // Extract area code (2 digits after country code)
        const areaCode = waId.substring(2, 4);
        const restOfNumber = waId.substring(4);

        // Check if the number has 9 digits and starts with 9
        if (restOfNumber.length === 9 && restOfNumber.startsWith('9')) {
            // Remove the 9 to get the old format
            alternativeNumber = `55${areaCode}${restOfNumber.substring(1)}`;
        }
        // Check if the number has 8 digits (old format)
        else if (restOfNumber.length === 8) {
            // Add 9 to get the new format
            alternativeNumber = `55${areaCode}9${restOfNumber}`;
        } else {
            // Not a standard Brazilian mobile number format
            return null;
        }

        // Search for the alternative number
        contact = await this.prisma.contact.findUnique({
            where: { waId: alternativeNumber },
        });

        return contact;
    }

    /**
     * Verify webhook token and mode
     *
     * @param mode Webhook mode
     * @param token Webhook token
     * @returns True if verification is successful
     */
    public verifyWebhook(mode: string, token: string): boolean {
        const WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

        if (!WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
            console.log('WHATSAPP_WEBHOOK_VERIFY_TOKEN environment variable is not set');
            return false;
        }

        if (mode === 'subscribe' && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
            this.logger.info('WhatsApp webhook verified successfully');
            return true;
        }

        console.log('WhatsApp webhook verification failed: invalid token or mode');
        return false;
    }

    /**
     * Process incoming webhook event (enqueue for background processing)
     *
     * @param body Webhook event body
     */
    public async processWebhookEvent(body: any): Promise<void> {
        try {
            this.logger.info('WhatsApp webhook received: ' + JSON.stringify(body));

            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            if (!value) {
                return;
            }

            // Build a deterministic idempotency key from WhatsApp payload identifiers.
            const messageId = value.messages?.[0]?.id;
            const statusId = value.statuses?.[0]?.id;
            const fallbackId = body?.entry?.[0]?.id;
            const sourceId = messageId || statusId || fallbackId || `${Date.now()}`;
            const idempotencyKey = `webhook-${value.messaging_product || 'whatsapp'}-${sourceId}`;

            // Enqueue the webhook for background processing
            await this.webhookQueue.add(
                'process-webhook',
                { body, idempotencyKey },
                {
                    jobId: idempotencyKey,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000,
                    },
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            );

            this.logger.info(`Webhook enqueued with idempotencyKey: ${idempotencyKey}`);
        } catch (error) {
            this.logger.error(`Error enqueueing webhook: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Process incoming webhook event (called by background worker)
     *
     * @param body Webhook event body
     * @param idempotencyKey Unique key for deduplication
     */
    public async processWebhookEventAsync(body: any, idempotencyKey: string): Promise<void> {
        // Check if already processed (idempotency)
        const processedKey = `processed-webhook:${idempotencyKey}`;
        const alreadyProcessed = await this.redisCache.exists(processedKey);
        if (alreadyProcessed) {
            this.logger.info(`Webhook already processed: ${idempotencyKey}`);
            return;
        }

        try {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            if (!value) {
                return;
            }

            // Handle incoming messages
            if (value.messages) {
                await this.handleIncomingMessage(value);
            }

            // Handle status updates
            if (value.statuses) {
                await this.handleStatusUpdate(value);
            }

            // Mark as processed in cache for 24 hours
            await this.redisCache.set(processedKey, true, 86400);
        } catch (error) {
            this.logger.error(`Error processing webhook async: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Handle incoming message from webhook
     */
    private async handleIncomingMessage(value: any): Promise<void> {
        try {
            const message = value.messages[0];
            const contact = value.contacts[0];

            // Check for existing contact with Brazilian number variations (with/without 9)
            let dbContact = await this.findContactWithBrVariations(contact.wa_id);

            // If no existing contact found, create a new one
            if (!dbContact) {
                dbContact = await this.prisma.contact.create({
                    data: {
                        waId: contact.wa_id,
                        name: contact.profile?.name,
                    },
                });
            } else {
                // Update the name if it changed
                if (contact.profile?.name && contact.profile.name !== dbContact.name) {
                    dbContact = await this.prisma.contact.update({
                        where: { id: dbContact.id },
                        data: { name: contact.profile.name },
                    });
                }
            }

            // Get or create conversation (should always exist for message history)
            const conversation = await this.prisma.conversation.upsert({
                where: { contactId: dbContact.id },
                update: {
                    unreadCount: { increment: 1 },
                },
                create: {
                    contactId: dbContact.id,
                    unreadCount: 1,
                },
            });

            // Check if this is the first message from this contact (including outbound)
            const existingMessagesCount = await this.prisma.message.count({
                where: { contactId: dbContact.id },
            });

            const isFirstMessage = existingMessagesCount === 0;

            // Send welcome messages for first-time contacts
            if (isFirstMessage) {
                // First welcome message
                const welcomeText = `Olá! Você está falando com o Bot de WhatsApp de Alessandro. 👋`;
                const welcomeMsg = await this.outboundMessenger.sendTextMessage(contact.wa_id, welcomeText);
                await this.messagePersistence.saveOutboundMessage(conversation.id, dbContact.id, welcomeText, welcomeMsg?.messages?.[0]?.id);

                // // Second message about checking registration
                const checkingText = `Estamos conferindo se o seu número está cadastrado em algum projeto para direcioná-lo corretamente...`;
                const checkingMsg = await this.outboundMessenger.sendTextMessage(contact.wa_id, checkingText);
                await this.messagePersistence.saveOutboundMessage(conversation.id, dbContact.id, checkingText, checkingMsg?.messages?.[0]?.id);
            }

            // Save the incoming message first (ensures webhook responds quickly)
            await this.messagePersistence.saveIncomingMessage(message, conversation.id, dbContact.id);

            // Send push notifications to all subscribed users
            try {
                const contactDisplayName = dbContact.customName || dbContact.name || dbContact.waId;
                const messageBody = message.type === 'text' 
                    ? message.text.body 
                    : `Nova mensagem (${message.type})`;
                
                await this.notificationService.sendToAll({
                    title: `${contactDisplayName}`,
                    body: messageBody.substring(0, 100), // Truncate to 100 chars
                    icon: '/icon-192x192.png',
                    badge: '/badge-72x72.png',
                    data: {
                        url: '/chat',
                        conversationId: conversation.id,
                        contactId: dbContact.id,
                    },
                });
            } catch (error) {
                console.log('Error sending push notification for incoming message:', error instanceof Error ? error.message : String(error));
            }

            // Handle project selection logic in background (non-blocking)
            setImmediate(() => {
                this.processMessageLogic(dbContact, contact, message, conversation)
                    .catch(err => console.log('Error in background message processing:', err));
            });

        } catch (error) {
            console.log('Error handling incoming message:', error);
            throw new HttpException('Error handling incoming message', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Process message logic in background (non-blocking)
     */
    private async processMessageLogic(dbContact: any, contact: any, message: any, conversation: any): Promise<void> {
        try {
            const messageText = message.type === 'text' ? message.text.body.trim() : '';
            let session = await this.sessionService.getOrCreateSession(dbContact.id, dbContact.projectId ?? null);

            const actionResult = await this.actionRouterService.route({
                dbContact,
                contactPayload: contact,
                conversation,
                message,
                messageText,
                session,
            });

            if (actionResult.handled && actionResult.stopProcessing) {
                return;
            }

            // If contact doesn't have a project assigned, check projects
            if (!session.activeProjectId) {
                const projectIds = await this.projectContextService.checkContactInProjectsWithCache(contact.wa_id);
                await this.projectContextService.handleProjectSelection(dbContact, projectIds, conversation.id);
                session = await this.sessionService.getOrCreateSession(dbContact.id, null);

                // If still no project after selection (not in any project), notify
                if (!session.activeProjectId && !this.sessionService.isAwaitingProjectSelection(session)) {
                    const notRegisteredText = `❌ Desculpe, você não está cadastrado em nenhum projeto no momento.`;
                    const sentMessage = await this.outboundMessenger.sendTextMessage(
                        contact.wa_id,
                        notRegisteredText
                    );

                    // Save the outbound message
                    await this.messagePersistence.saveOutboundMessage(conversation.id, dbContact.id, notRegisteredText, sentMessage?.messages?.[0]?.id);
                    return;
                }

                // If now pending selection, the message was sent
                if (this.sessionService.isAwaitingProjectSelection(session)) {
                    return;
                }
            }

            this.logger.info(`Processed ${message.type} message from ${contact.profile?.name || contact.wa_id}`);
        } catch (error) {
            console.log('Error in message processing logic:', error);
        }
    }

    /**
     * Handle status update from webhook
     */
    private async handleStatusUpdate(value: any): Promise<void> {
        try {
            const status = value.statuses[0];

            // Log error details if present (e.g., media too large, download errors)
            if (status.errors && status.errors.length > 0) {
                console.log(`Message ${status.id} failed with errors:`, JSON.stringify(status.errors, null, 2));
            }

            // Check if message exists before updating
            const existingMessage = await this.prisma.message.findUnique({
                where: { id: status.id }
            });

            if (!existingMessage) {
                // If message doesn't exist and status is 'failed', create it with error info
                if (status.status === 'failed' && status.recipient_id) {
                    console.log(`Creating failed message ${status.id} in database (never received original message webhook)`);
                    await this.createFailedMessage(status);
                    return;
                }
                
                console.log(`Message ${status.id} not found in database - status: ${status.status}. Skipping update.`);
                return;
            }

            const updateData: any = {
                status: this.mapStatus(status.status),
            };

            if (status.status === 'sent') {
                updateData.sentAt = new Date(parseInt(status.timestamp) * 1000);
            } else if (status.status === 'delivered') {
                updateData.deliveredAt = new Date(parseInt(status.timestamp) * 1000);
            } else if (status.status === 'read') {
                updateData.readAt = new Date(parseInt(status.timestamp) * 1000);
            } else if (status.status === 'failed') {
                updateData.failedAt = new Date(parseInt(status.timestamp) * 1000);
                updateData.status = $Enums.MessageStatus.FAILED;
            }

            // Update message status
            await this.prisma.message.update({
                where: { id: status.id },
                data: updateData,
            });

            console.log(`Updated message ${status.id} to status: ${status.status}`);
        } catch (error) {
            console.log('Error handling status update:', error);
            // Don't throw error to prevent webhook failures
        }
    }

    /**
     * Create a failed message in the database when we receive a failed status
     * but never received the original message webhook (e.g., media too large)
     */
    private async createFailedMessage(status: any): Promise<void> {
        try {
            const phoneNumber = status.recipient_id;
            
            // Find or create contact (considering Brazilian phone number variations)
            let contact = await this.findContactWithBrVariations(phoneNumber);

            if (!contact) {
                contact = await this.prisma.contact.create({
                    data: {
                        waId: phoneNumber,
                        name: phoneNumber
                    }
                });
                console.log(`Created new contact for ${phoneNumber}`);
            } else {
                console.log(`Found existing contact for ${phoneNumber} (matched waId: ${contact.waId})`);
            }

            // Find or create conversation
            let conversation = await this.prisma.conversation.findFirst({
                where: { contactId: contact.id }
            });

            if (!conversation) {
                conversation = await this.prisma.conversation.create({
                    data: {
                        id: `cml${Date.now()}${Math.random().toString(36).substring(2, 15)}`,
                        contactId: contact.id
                    }
                });
            }

            // Extract error message
            let errorMessage = 'Falha ao processar mídia';
            if (status.errors && status.errors.length > 0) {
                const error = status.errors[0];
                if (error.error_data?.details) {
                    errorMessage = error.error_data.details;
                } else if (error.message) {
                    errorMessage = error.message;
                }
            }

            // Create the failed message
            await this.prisma.message.create({
                data: {
                    id: status.id,
                    conversationId: conversation.id,
                    contactId: contact.id,
                    type: $Enums.MessageType.UNSUPPORTED,
                    direction: $Enums.Direction.INBOUND,
                    timestamp: BigInt(parseInt(status.timestamp) * 1000),
                    status: $Enums.MessageStatus.FAILED,
                    failedAt: new Date(parseInt(status.timestamp) * 1000),
                    textBody: `[❌ Erro de mídia] ${errorMessage}`
                }
            });

            // Update conversation unread count
            await this.prisma.conversation.update({
                where: { id: conversation.id },
                data: { 
                    unreadCount: { increment: 1 }
                }
            });

            console.log(`Created failed message ${status.id} for ${phoneNumber}`);
        } catch (error) {
            console.log('Error creating failed message:', error);
        }
    }

    /**
     * Transform message media paths to full CloudFront URLs
     */
    private transformMessageMediaUrl(message: any): any {
        if (message.mediaLocalPath) {
            return {
                ...message,
                mediaLocalPath: this.awsService.getCloudFrontUrl(message.mediaLocalPath)
            };
        }
        return message;
    }

    /**
     * Map WhatsApp status to database enum
     */
    private mapStatus(status: string): $Enums.MessageStatus {
        const statusMap: Record<string, $Enums.MessageStatus> = {
            sent: $Enums.MessageStatus.SENT,
            delivered: $Enums.MessageStatus.DELIVERED,
            read: $Enums.MessageStatus.READ,
            failed: $Enums.MessageStatus.FAILED,
        };
        return statusMap[status] || $Enums.MessageStatus.SENT;
    }

    /**
     * Send text message
     */
    public async sendTextMessage(conversationId: string, text: string, replyToId?: string): Promise<any> {
        try {
            // Get conversation to find recipient
            const conversation = await this.prisma.conversation.findUnique({
                where: { id: conversationId },
                include: { contact: true },
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            // Send via WhatsApp API
            const response = await this.outboundMessenger.sendTextMessage(conversation.contact.waId, text, replyToId);

            const messageId = response.messages[0].id;

            // Save to database
            const message = await this.prisma.message.create({
                data: {
                    id: messageId,
                    conversationId,
                    contactId: conversation.contactId,
                    type: $Enums.MessageType.TEXT,
                    direction: $Enums.Direction.OUTBOUND,
                    timestamp: BigInt(Date.now()),
                    textBody: text,
                    status: $Enums.MessageStatus.SENT,
                    sentAt: new Date(),
                    replyToId: replyToId || null,
                },
            });

            // Convert BigInt to string for JSON serialization
            return {
                ...message,
                timestamp: message.timestamp.toString(),
            };
        } catch (error) {
            console.log('Error sending message:', error);
            throw new HttpException('Error sending message', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Get all conversations
     */
    public async getConversations(): Promise<any[]> {
        const conversations = await this.prisma.conversation.findMany({
            include: {
                contact: true,
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: 1,
                },
            },
        });

        // For each conversation, find the last inbound message or last outbound template
        const conversationsWithWindow = await Promise.all(
            conversations.map(async (conv) => {
                // Calculate lastMessageAt from the last message
                const lastMessageAt = conv.messages.length > 0 
                    ? new Date(Number(conv.messages[0].timestamp)).toISOString()
                    : conv.createdAt.toISOString();

                // Find last inbound message OR last outbound template message
                const lastRelevantMessage = await this.prisma.message.findFirst({
                    where: {
                        conversationId: conv.id,
                        OR: [
                            { direction: 'INBOUND' },
                            {
                                direction: 'OUTBOUND',
                                templateHeader: { not: null },
                            },
                        ],
                    },
                    orderBy: { timestamp: 'desc' },
                });

                // Calculate if we're within 24h window
                let isWithin24Hours = false;
                let lastRelevantMessageTime: Date | null = null;
                
                if (lastRelevantMessage) {
                    lastRelevantMessageTime = new Date(Number(lastRelevantMessage.timestamp));
                    const now = new Date();
                    const hoursSince = (now.getTime() - lastRelevantMessageTime.getTime()) / (1000 * 60 * 60);
                    isWithin24Hours = hoursSince < 24;
                }

                return {
                    ...conv,
                    lastMessageAt,
                    isWithin24Hours,
                    lastRelevantMessageTime: lastRelevantMessageTime?.toISOString() || null,
                    messages: conv.messages.map(msg => {
                        const transformedMsg = this.transformMessageMediaUrl(msg);
                        return {
                            ...transformedMsg,
                            timestamp: transformedMsg.timestamp.toString(),
                        };
                    }),
                };
            })
        );

        // Sort by lastMessageAt descending
        conversationsWithWindow.sort((a, b) => {
            return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
        });

        // Convert BigInt to string for JSON serialization
        return conversationsWithWindow;
    }

    /**
     * Get messages for a conversation
     */
    public async getMessages(conversationId: string): Promise<any[]> {
        // Mark messages as read
        await this.prisma.conversation.update({
            where: { id: conversationId },
            data: { unreadCount: 0 },
        });

        const messages = await this.prisma.message.findMany({
            where: { conversationId },
            orderBy: { timestamp: 'asc' },
            include: {
                contact: true,
                replyTo: {
                    include: {
                        contact: true,
                    },
                },
            },
        });

        // Convert BigInt to string for JSON serialization and add CloudFront URLs
        return messages.map(msg => {
            const transformedMsg = this.transformMessageMediaUrl(msg);
            return {
                ...transformedMsg,
                timestamp: transformedMsg.timestamp.toString(),
                replyTo: transformedMsg.replyTo ? {
                    ...this.transformMessageMediaUrl(transformedMsg.replyTo),
                    timestamp: transformedMsg.replyTo.timestamp.toString(),
                } : null,
            };
        });
    }

    /**
     * Send invite to church template message
     */
    public async inviteToChurch(
        to: string,
        name: string,
        platform: string,
        platformUrl: string,
        login: string,
        password: string,
        projectId?: number
    ): Promise<any> {
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

            // Create the formatted message text
            const messageText = `Bem vindo ${name}
                Olá, seu acesso à plataforma ${platform} foi criado.
                Você pode estar acessando através desse link:
                ${platformUrl}
                Com o seguinte acesso:
                ${login}
                Senha: ${password}

                Por favor mude a sua senha após o primeiro acesso.
                Plataforma feita por Alessandro Cardoso`;

            // Check for existing contact with Brazilian number variations (with/without 9)
            let dbContact = await this.findContactWithBrVariations(to);

            // If no existing contact found, create a new one with custom name and project
            if (!dbContact) {
                dbContact = await this.prisma.contact.create({
                    data: {
                        waId: to,
                        customName: name, // Set custom name from invite
                        ...(projectId && { projectId }),
                    },
                });
            } else {
                // Update custom name and project if contact exists
                dbContact = await this.prisma.contact.update({
                    where: { id: dbContact.id },
                    data: { 
                        customName: name,
                        ...(projectId && { projectId }),
                    },
                });
            }

            // Get or create conversation
            const conversation = await this.prisma.conversation.upsert({
                where: { contactId: dbContact.id },
                update: {},
                create: {
                    contactId: dbContact.id,
                    unreadCount: 0,
                },
            });

            // Save message to database
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

    /**
     * Send password reset template message
     */
    public async passwordReset(
        to: string,
        name: string,
        platformName: string,
        passwordResetUrl: string,
        projectId?: number
    ): Promise<any> {
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

            // Create the formatted message text
            const messageText = `Olá ${name}
Segue o link para redefinição de senha da sua conta:
${passwordResetUrl}
Se você não solicitou redefinição de senha, desconsidere essa mensagem.`;

            // Check for existing contact with Brazilian number variations (with/without 9)
            let dbContact = await this.findContactWithBrVariations(to);

            // If no existing contact found, create a new one with custom name and project
            if (!dbContact) {
                dbContact = await this.prisma.contact.create({
                    data: {
                        waId: to,
                        name: name,
                        customName: name,
                        projectId: projectId || null,
                    },
                });
            } else {
                // Update existing contact with custom name and project if not set
                await this.prisma.contact.update({
                    where: { id: dbContact.id },
                    data: {
                        customName: name,
                        projectId: dbContact.projectId || projectId || null,
                    },
                });
            }

            // Get or create conversation
            const conversation = await this.prisma.conversation.upsert({
                where: { contactId: dbContact.id },
                update: {},
                create: {
                    contactId: dbContact.id,
                    unreadCount: 0,
                },
            });

            // Save message to database
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

    /**
     * Update contact custom name
     */
    public async updateContactCustomName(contactId: string, customName: string): Promise<any> {
        try {
            const contact = await this.prisma.contact.update({
                where: { id: contactId },
                data: { customName },
            });

            return contact;
        } catch (error) {
            console.log('Error updating custom name:', error);
            throw new HttpException('Error updating custom name', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

}
