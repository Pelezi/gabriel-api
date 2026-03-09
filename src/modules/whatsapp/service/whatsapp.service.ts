import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LoggerService } from '../../common/provider';
import { PrismaService } from '../../common';
import { WhatsAppApiHelper } from '../helpers';
import { $Enums } from '../../../generated/prisma/client';
// import { NotificationService } from '../../notification';
import { AwsService } from '../../common/provider/aws.provider';
import { v4 as uuidv4 } from 'uuid';
// import axios from 'axios';

@Injectable()
export class WhatsappService {

    private whatsappApi: WhatsAppApiHelper;
    // private projectCheckLocks = new Map<string, Promise<number[]>>();
    // private projectCheckCache = new Map<string, { projectIds: number[], timestamp: number }>();

    public constructor(
        private readonly logger: LoggerService,
        private readonly prisma: PrismaService,
        // private readonly notificationService: NotificationService,
        private readonly awsService: AwsService
    ) {
        this.whatsappApi = new WhatsAppApiHelper();
    }

    // /**
    //  * Check which projects contain this phone number (with caching and locks)
    //  * 
    //  * @param phoneNumber WhatsApp phone number
    //  * @returns Array of project IDs where the number exists
    //  */
    // private async checkContactInProjectsWithCache(phoneNumber: string): Promise<number[]> {
    //     // Check cache first
    //     const cached = this.projectCheckCache.get(phoneNumber);
    //     const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    //     if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    //         console.log(`Using cached project check for ${phoneNumber}`);
    //         return cached.projectIds;
    //     }

    //     // Check if already checking (prevent race conditions)
    //     const existingCheck = this.projectCheckLocks.get(phoneNumber);
    //     if (existingCheck) {
    //         console.log(`Waiting for existing project check for ${phoneNumber}`);
    //         return existingCheck;
    //     }

    //     // Create new check promise
    //     const checkPromise = this.checkContactInProjects(phoneNumber);
    //     this.projectCheckLocks.set(phoneNumber, checkPromise);

    //     try {
    //         const projectIds = await checkPromise;
            
    //         // Cache the result
    //         this.projectCheckCache.set(phoneNumber, {
    //             projectIds,
    //             timestamp: Date.now()
    //         });

    //         return projectIds;
    //     } finally {
    //         // Cleanup lock after 5 seconds
    //         setTimeout(() => this.projectCheckLocks.delete(phoneNumber), 5000);
    //     }
    // }

    // /**
    //  * Check which projects contain this phone number (parallel API calls)
    //  * 
    //  * @param phoneNumber WhatsApp phone number
    //  * @returns Array of project IDs where the number exists
    //  */
    // private async checkContactInProjects(phoneNumber: string): Promise<number[]> {
    //     try {
    //         // Filter projects with required configuration
    //         const projects = await this.prisma.project.findMany({
    //             where: {
    //                 AND: [
    //                     { apiUrl: { not: null } },
    //                     { userNumbersApiUrl: { not: null } }
    //                 ]
    //             }
    //         });

    //         console.log(`Checking ${projects.length} projects for phone ${phoneNumber}`);

    //         // Parallel API calls for better performance
    //         const results = await Promise.allSettled(
    //             projects.map(async (project) => {
    //                 try {
    //                     const headers: any = {};
    //                     if (project.apiKey) {
    //                         headers['X-API-KEY'] = project.apiKey;
    //                     }

    //                     const baseUrl = project.apiUrl!.replace(/\/$/, '');
    //                     const route = project.userNumbersApiUrl!.startsWith('/') 
    //                         ? project.userNumbersApiUrl 
    //                         : `/${project.userNumbersApiUrl}`;
    //                     const fullUrl = `${baseUrl}${route}`;

    //                     const response = await axios.get(fullUrl, {
    //                         params: { phone: phoneNumber },
    //                         timeout: 5000, // Reduced from 63s to 5s
    //                         headers,
    //                     });

    //                     const exists = response.data === true || response.data?.exists === true;
    //                     return { projectId: project.id, projectName: project.name, exists };
    //                 } catch (error) {
    //                     console.log(`Error checking project ${project.name}: ${error.message}`);
    //                     return { projectId: project.id, projectName: project.name, exists: false };
    //                 }
    //             })
    //         );

    //         // Extract successful results
    //         const projectIds = results
    //             .filter(r => r.status === 'fulfilled' && r.value.exists)
    //             .map(r => (r as PromiseFulfilledResult<any>).value.projectId);

    //         const failures = results.filter(r => r.status === 'rejected');
    //         if (failures.length > 0) {
    //             console.log(`⚠️ ${failures.length}/${projects.length} project checks failed`);
    //         }

    //         console.log(`Found ${projectIds.length} matching projects for ${phoneNumber}`);
    //         return projectIds;
    //     } catch (error) {
    //         console.log(`Error checking contact in projects: ${error}`);
    //         return [];
    //     }
    // }

    // /**
    //  * Handle project selection by contact
    //  * 
    //  * @param contact Contact object
    //  * @param projectIds Available project IDs
    //  * @param conversationId Optional conversation ID for sending messages
    //  */
    // private async handleProjectSelection(contact: any, projectIds: number[], conversationId?: string): Promise<void> {
    //     try {
    //         if (projectIds.length === 0) {
    //             // Contact not in any project - clear project association
    //             await this.prisma.contact.update({
    //                 where: { id: contact.id },
    //                 data: {
    //                     projectId: null,
    //                     pendingProjectSelection: false,
    //                     availableProjectIds: null,
    //                 },
    //             });
    //             return;
    //         }

    //         if (projectIds.length === 1) {
    //             // Automatically select the only project
    //             await this.prisma.contact.update({
    //                 where: { id: contact.id },
    //                 data: {
    //                     projectId: projectIds[0],
    //                     pendingProjectSelection: false,
    //                     availableProjectIds: null,
    //                 },
    //             });

    //             // Send message informing which project was detected
    //             const detectedProject = await this.prisma.project.findUnique({
    //                 where: { id: projectIds[0] },
    //             });

    //             if (detectedProject && conversationId) {
    //                 const detectedText = `✅ Número encontrado! Você foi detectado no projeto: *${detectedProject.name}*`;
    //                 const detectedMsg = await this.whatsappApi.sendTextMessage(contact.waId, detectedText);
    //                 await this.saveOutboundMessage(conversationId, contact.id, detectedText, detectedMsg?.messages?.[0]?.id);
    //             }

    //             return;
    //         }

    //         // Multiple projects - ask user to choose
    //         const projects = await this.prisma.project.findMany({
    //             where: { id: { in: projectIds } },
    //         });

    //         let message = '📋 *Múltiplos Projetos Encontrados*\n\n';
    //         message += 'Você está cadastrado nos seguintes projetos:\n\n';
    //         projects.forEach((project) => {
    //             message += `*${project.id}* - ${project.name}\n`;
    //         });
    //             message += '\n💬 *Responda com o número* do projeto desejado.';
    //         message += '\n❌ Digite *cancelar* para sair.';

    //         // Send the selection message
    //         const sentMessage = await this.whatsappApi.sendTextMessage(contact.waId, message);

    //         // Get or create conversation for saving the outbound message
    //         let conversation;
    //         if (conversationId) {
    //             conversation = await this.prisma.conversation.findUnique({
    //                 where: { id: conversationId },
    //             });
    //         }
            
    //         if (!conversation) {
    //             conversation = await this.prisma.conversation.upsert({
    //                 where: { contactId: contact.id },
    //                 update: {},
    //                 create: {
    //                     contactId: contact.id,
    //                     unreadCount: 0,
    //                 },
    //             });
    //         }

    //         // Save the outbound message
    //         await this.saveOutboundMessage(conversation.id, contact.id, message, sentMessage?.messages?.[0]?.id);

    //         // Update contact to pending selection state
    //         await this.prisma.contact.update({
    //             where: { id: contact.id },
    //             data: {
    //                 pendingProjectSelection: true,
    //                 availableProjectIds: projectIds.join(','),
    //                 projectId: null,
    //             },
    //         });
    //     } catch (error) {
    //         console.log(`Error handling project selection: ${error}`);
    //     }
    // }

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
     * Process incoming webhook event
     *
     * @param body Webhook event body
     */
    public async processWebhookEvent(body: any): Promise<void> {
        this.logger.info('WhatsApp webhook received: ' + JSON.stringify(body));

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
                const welcomeMsg = await this.whatsappApi.sendTextMessage(contact.wa_id, welcomeText);
                await this.saveOutboundMessage(conversation.id, dbContact.id, welcomeText, welcomeMsg?.messages?.[0]?.id);

                // // Second message about checking registration
                // const checkingText = `Estamos conferindo se o seu número está cadastrado em algum projeto para direcioná-lo corretamente...`;
                // const checkingMsg = await this.whatsappApi.sendTextMessage(contact.wa_id, checkingText);
                // await this.saveOutboundMessage(conversation.id, dbContact.id, checkingText, checkingMsg?.messages?.[0]?.id);
            }

            // Save the incoming message first (ensures webhook responds quickly)
            await this.saveIncomingMessage(message, conversation.id, dbContact.id);

            // // Handle project selection logic in background (non-blocking)
            // setImmediate(() => {
            //     this.processMessageLogic(dbContact, contact, message, conversation)
            //         .catch(err => console.log('Error in background message processing:', err));
            // });

        } catch (error) {
            console.log('Error handling incoming message:', error);
            throw new HttpException('Error handling incoming message', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    // /**
    //  * Process message logic in background (non-blocking)
    //  */
    // private async processMessageLogic(dbContact: any, contact: any, message: any, conversation: any): Promise<void> {
    //     try {
    //         const messageText = message.type === 'text' ? message.text.body.trim() : '';

    //         // Check if user sent "0" or "trocar projeto" to reset project selection
    //         if (messageText === '0' || messageText.toLowerCase() === 'trocar projeto') {
    //             await this.prisma.contact.update({
    //                 where: { id: dbContact.id },
    //                 data: { projectId: null, pendingProjectSelection: false }
    //             });
                
    //             const projectIds = await this.checkContactInProjectsWithCache(contact.wa_id);
    //             await this.handleProjectSelection(dbContact, projectIds, conversation.id);
    //             return;
    //         }

    //         // If contact is pending project selection, handle their choice
    //         if (dbContact.pendingProjectSelection && messageText) {
    //             // Handle cancellation
    //             if (messageText.toLowerCase() === 'cancelar') {
    //                 await this.prisma.contact.update({
    //                     where: { id: dbContact.id },
    //                     data: {
    //                         pendingProjectSelection: false,
    //                         availableProjectIds: null,
    //                     },
    //                 });
                    
    //                 const cancelMsg = '❌ Seleção cancelada. Envie uma mensagem quando precisar.';
    //                 const sentMsg = await this.whatsappApi.sendTextMessage(contact.wa_id, cancelMsg);
    //                 await this.saveOutboundMessage(conversation.id, dbContact.id, cancelMsg, sentMsg?.messages?.[0]?.id);
    //                 return;
    //             }

    //             const availableIds = dbContact.availableProjectIds?.split(',').map(Number) || [];
    //             const selectedProjectId = parseInt(messageText);

    //             if (availableIds.includes(selectedProjectId)) {
    //                 // Valid selection - set the project
    //                 await this.prisma.contact.update({
    //                     where: { id: dbContact.id },
    //                     data: {
    //                         projectId: selectedProjectId,
    //                         pendingProjectSelection: false,
    //                         availableProjectIds: null,
    //                     },
    //                 });

    //                 const selectedProject = await this.prisma.project.findUnique({
    //                     where: { id: selectedProjectId },
    //                 });

    //                 const confirmationText = `✅ Perfeito! Agora vamos falar sobre o projeto: *${selectedProject?.name}*. Como posso ajudá-lo?`;
    //                 const sentMessage = await this.whatsappApi.sendTextMessage(
    //                     contact.wa_id,
    //                     confirmationText
    //                 );

    //                 // Save the outbound message
    //                 await this.saveOutboundMessage(conversation.id, dbContact.id, confirmationText, sentMessage?.messages?.[0]?.id);
    //                 return;
    //             } else {
    //                 // Invalid selection - ask again
    //                 const errorText = `⚠️ Opção inválida. Por favor, escolha um dos números listados ou digite *cancelar*.`;
    //                 const sentMessage = await this.whatsappApi.sendTextMessage(
    //                     contact.wa_id,
    //                     errorText
    //                 );

    //                 // Save the outbound message
    //                 await this.saveOutboundMessage(conversation.id, dbContact.id, errorText, sentMessage?.messages?.[0]?.id);
    //                 return;
    //             }
    //         }

    //         // If contact doesn't have a project assigned, check projects
    //         if (!dbContact.projectId) {
    //             const projectIds = await this.checkContactInProjectsWithCache(contact.wa_id);
    //             await this.handleProjectSelection(dbContact, projectIds, conversation.id);

    //             // If still no project after selection (not in any project), notify
    //             const updatedContact = await this.prisma.contact.findUnique({
    //                 where: { id: dbContact.id },
    //             });

    //             if (!updatedContact?.projectId && !updatedContact?.pendingProjectSelection) {
    //                 const notRegisteredText = `❌ Desculpe, você não está cadastrado em nenhum projeto no momento.`;
    //                 const sentMessage = await this.whatsappApi.sendTextMessage(
    //                     contact.wa_id,
    //                     notRegisteredText
    //                 );

    //                 // Save the outbound message
    //                 await this.saveOutboundMessage(conversation.id, dbContact.id, notRegisteredText, sentMessage?.messages?.[0]?.id);
    //                 return;
    //             }

    //             // If now pending selection, the message was sent
    //             if (updatedContact?.pendingProjectSelection) {
    //                 return;
    //             }

    //             // Update dbContact reference with the newly assigned project
    //             dbContact = updatedContact;
    //         }

    //         // Send push notification for regular message
    //         try {
    //             const contactDisplayName = dbContact.customName || dbContact.name || dbContact.waId;
    //             const messageBody = message.type === 'text' 
    //                 ? message.text.body 
    //                 : `Nova mensagem (${message.type})`;
    //             await this.notificationService.notifyNewMessage(
    //                 contactDisplayName,
    //                 messageBody,
    //                 conversation.id
    //             );
    //         } catch (error) {
    //             console.log('Error sending push notification:', error.message);
    //         }

    //         this.logger.info(`Processed ${message.type} message from ${contact.profile?.name || contact.wa_id}`);
    //     } catch (error) {
    //         console.log('Error in message processing logic:', error);
    //     }
    // }

    /**
     * Save incoming message to database
     */
    private async saveIncomingMessage(message: any, conversationId: string, contactId: string): Promise<void> {
        // Process message based on type
        const messageData: any = {
            id: message.id,
            conversationId: conversationId,
            contactId: contactId,
            type: this.mapMessageType(message.type),
            direction: $Enums.Direction.INBOUND,
            timestamp: BigInt(parseInt(message.timestamp) * 1000),
            status: $Enums.MessageStatus.DELIVERED,
        };

        // Handle context (reply to another message)
        if (message.context?.id) {
            messageData.replyToId = message.context.id;
        }

        // Handle different message types
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
                } catch (error) {
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
                } catch (error) {
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
                } catch (error) {
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
                } catch (error) {
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
                } catch (error) {
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
                // Just save as unsupported
                break;
        }

        // Save message to database
        await this.prisma.message.create({ data: messageData });
    }

    /**
     * Save outbound text message to database
     */
    private async saveOutboundMessage(conversationId: string, contactId: string, textBody: string, wamid?: string): Promise<void> {
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
     * Download media from WhatsApp, upload to S3 and return S3 key (not full URL)
     */
    private async downloadAndSaveMedia(
        mediaId: string,
        mimeType: string,
        mediaType: 'image' | 'video' | 'audio' | 'sticker' | 'document',
        filename?: string
    ): Promise<string> {
        try {
            const buffer = await this.whatsappApi.downloadMedia(mediaId);

            // Map media type to folder name
            const folderMap = {
                'image': 'images',
                'video': 'videos',
                'audio': 'audio',
                'sticker': 'stickers',
                'document': 'documents'
            };

            const folder = folderMap[mediaType];
            const extension = mimeType.split('/')[1]?.split(';')[0] || 'bin';
            const s3Key = `whatsapp-media/${folder}/${filename || `${uuidv4()}.${extension}`}`;

            // Upload to S3
            await this.awsService.uploadFile(buffer, s3Key, mimeType);
            
            // Return only the S3 key (not the full CloudFront URL)
            return s3Key;
        } catch (error) {
            console.log('Error downloading/uploading media:', error);
            throw new HttpException('Error downloading media', HttpStatus.INTERNAL_SERVER_ERROR);
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
     * Map WhatsApp message type to database enum
     */
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
            const response = await this.whatsappApi.sendTextMessage(conversation.contact.waId, text, replyToId);

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
        requestHost: string
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

            const response = await this.whatsappApi.sendTemplateMessage(
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

            // Find project that matches the request host
            let matchingProject = null;
            try {
                // Remove port from host if present (e.g., "example.com:3000" -> "example.com")
                const hostname = requestHost.split(':')[0];
                
                // Find project where apiUrl contains the request hostname
                const projects = await this.prisma.project.findMany({
                    where: {
                        apiUrl: {
                            contains: hostname,
                        },
                    },
                });

                if (projects.length > 0) {
                    matchingProject = projects[0];
                }
            } catch (error) {
                console.log('Error matching project by request host:', error.message);
            }

            console.log('hostname:', requestHost, 'matchingProject:', matchingProject?.name);

            // If no existing contact found, create a new one with custom name and project
            if (!dbContact) {
                dbContact = await this.prisma.contact.create({
                    data: {
                        waId: to,
                        customName: name, // Set custom name from invite
                        ...(matchingProject && { projectId: matchingProject.id }),
                    },
                });
            } else {
                // Update custom name and project if contact exists
                dbContact = await this.prisma.contact.update({
                    where: { id: dbContact.id },
                    data: { 
                        customName: name,
                        ...(matchingProject && { projectId: matchingProject.id }),
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
        requestHost: string
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

            const response = await this.whatsappApi.sendTemplateMessage(
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

            // Find project that matches the request host
            let matchingProject = null;
            try {
                // Remove port from host if present (e.g., "example.com:3000" -> "example.com")
                const hostname = requestHost.split(':')[0];
                
                // Find project where apiUrl contains the request hostname
                const projects = await this.prisma.project.findMany({
                    where: {
                        apiUrl: {
                            contains: hostname,
                        },
                    },
                });

                if (projects.length > 0) {
                    matchingProject = projects[0];
                }
            } catch (error) {
                console.log('Error matching project by request host:', error.message);
            }

            // If no existing contact found, create a new one with custom name and project
            if (!dbContact) {
                dbContact = await this.prisma.contact.create({
                    data: {
                        waId: to,
                        name: name,
                        customName: name,
                        projectId: matchingProject?.id || null,
                    },
                });
            } else {
                // Update existing contact with custom name and project if not set
                await this.prisma.contact.update({
                    where: { id: dbContact.id },
                    data: {
                        customName: name,
                        projectId: dbContact.projectId || matchingProject?.id || null,
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
