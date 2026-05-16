import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { CommonModule } from './common';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { ProjectModule } from './project/project.module';
import { NotificationModule } from './notification/notification.module';
import { QueueModule } from './queue/queue.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        CommonModule,
        QueueModule,
        AuthModule,
        UserModule,
        WhatsappModule,
        ProjectModule,
        NotificationModule
    ]
})
export class ApplicationModule {}
