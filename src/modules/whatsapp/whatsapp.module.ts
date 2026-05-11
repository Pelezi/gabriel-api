import { Module } from '@nestjs/common';

import { CommonModule } from '../common';
import { NotificationModule } from '../notification';
import { QueueModule } from '../queue';
import { WhatsappWebhookProcessor } from '../queue/processors/whatsapp-webhook.processor';
import {
    DefaultProjectAdapter,
    ProjectAdapterRegistryService,
    TalentosProjectAdapter,
    UvasProjectAdapter
} from './integrations';
import {
    ActionRouterService,
    HelpAction,
    MenuAction,
    PendingProjectSelectionAction,
    SwitchProjectAction
} from './actions';
import { WhatsappController, ConversationController } from './controller';
import {
    ConversationSessionService,
    MessagePersistenceService,
    OutboundMessengerService,
    ProjectContextService,
    WhatsappService
} from './service';

@Module({
    imports: [
        CommonModule,
        QueueModule,
        NotificationModule
    ],
    providers: [
        WhatsappWebhookProcessor,
        WhatsappService,
        OutboundMessengerService,
        MessagePersistenceService,
        ProjectContextService,
        ConversationSessionService,
        ActionRouterService,
        PendingProjectSelectionAction,
        SwitchProjectAction,
        MenuAction,
        HelpAction,
        ProjectAdapterRegistryService,
        DefaultProjectAdapter,
        UvasProjectAdapter,
        TalentosProjectAdapter
    ],
    controllers: [
        WhatsappController,
        ConversationController
    ]
})
export class WhatsappModule { }
