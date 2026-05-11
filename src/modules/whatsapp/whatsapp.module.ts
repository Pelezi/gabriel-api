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
    SwitchProjectAction,
    UvasFillReportReminderAction,
    UvasInviteToChurchAction,
    UvasPasswordResetAction,
    UvasRegisterAttendanceAction,
    UvasUploadAnnouncementAction,
    UvasUploadMagazineAction
} from './actions';
import { WhatsappController, ConversationController } from './controller';
import {
    ContactResolverService,
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
        ContactResolverService,
        ProjectContextService,
        ConversationSessionService,
        ActionRouterService,
        PendingProjectSelectionAction,
        SwitchProjectAction,
        MenuAction,
        HelpAction,
        UvasInviteToChurchAction,
        UvasPasswordResetAction,
        UvasFillReportReminderAction,
        UvasRegisterAttendanceAction,
        UvasUploadMagazineAction,
        UvasUploadAnnouncementAction,
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
