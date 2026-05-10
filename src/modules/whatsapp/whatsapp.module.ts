import { Module } from '@nestjs/common';

import { CommonModule } from '../common';
import { NotificationModule } from '../notification';
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
        NotificationModule
    ],
    providers: [
        WhatsappService,
        OutboundMessengerService,
        MessagePersistenceService,
        ProjectContextService,
        ConversationSessionService
    ],
    controllers: [
        WhatsappController,
        ConversationController
    ]
})
export class WhatsappModule { }
