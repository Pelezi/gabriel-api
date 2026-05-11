import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './controller';
import { LogInterceptor } from './flow';
import { configProvider, LoggerService, PrismaService } from './provider';
import { EmailService } from './provider/email.provider';
import { AwsService } from './provider/aws.provider';
import { RedisCache } from './provider/redis-cache.provider';
import { RedisLock } from './provider/redis-lock.provider';

@Module({
    imports: [
        TerminusModule
    ],
    providers: [
        configProvider,
        LoggerService,
        LogInterceptor,
        PrismaService,
        EmailService,
        AwsService,
        RedisCache,
        RedisLock
    ],
    exports: [
        configProvider,
        LoggerService,
        LogInterceptor,
        PrismaService,
        EmailService,
        AwsService,
        RedisCache,
        RedisLock
    ],
    controllers: [
        HealthController
    ],
})
export class CommonModule {}
