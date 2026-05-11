import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue(
      {
        name: 'whatsapp-webhook',
      },
      {
        name: 'project-membership-check',
      },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
