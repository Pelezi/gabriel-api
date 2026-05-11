import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../modules/common/provider';
import { WhatsappService } from '../../whatsapp/service';

@Processor('whatsapp-webhook')
@Injectable()
export class WhatsappWebhookProcessor extends WorkerHost {
  
  public constructor(
    private readonly logger: LoggerService,
    private readonly whatsappService: WhatsappService
  ) {
    super();
  }

  async process(job: Job<any>): Promise<void> {
    try {
      this.logger.info(`Processing webhook job ${job.id}`);
      
      const { body, idempotencyKey } = job.data;
      
      // Call the internal processing method
      await this.whatsappService.processWebhookEventAsync(body, idempotencyKey);
      
      this.logger.info(`Webhook job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(`Error processing webhook job ${job.id}: ${error.message}`, error.stack);
      
      // Re-throw to trigger retries
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.info(`Job ${job.id} completed successfully`);
  }
}
