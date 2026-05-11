import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { LoggerService } from '../../common/provider';

@Injectable()
export class RedisLock implements OnApplicationShutdown {
  private redis: Redis;
  private readonly DEFAULT_LOCK_TTL = 30; // 30 seconds
  private readonly LOCK_PREFIX = 'lock:';

  public constructor(
    private readonly logger: LoggerService
  ) {
    this.initializeRedis();
  }

  private initializeRedis(): void {
    const host = process.env.REDIS_HOST || 'redis';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    
    this.redis = new Redis({
      host,
      port,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableReadyCheck: true,
      enableOfflineQueue: true,
    });

    this.redis.on('error', (err) => {
      this.logger.error(`Redis Lock Error: ${err.message}`, err.stack);
    });

    this.redis.on('connect', () => {
      this.logger.info('Redis Lock connected successfully');
    });
  }

  /**
   * Acquire a lock for the given key
   * Returns a lock ID that must be used to release the lock
   */
  async acquire(key: string, ttlSeconds: number = this.DEFAULT_LOCK_TTL): Promise<string | null> {
    try {
      const lockId = `${Date.now()}-${Math.random()}`;
      const lockKey = `${this.LOCK_PREFIX}${key}`;
      
      // Use SET with NX (only if not exists) and EX (expiration)
      const result = await this.redis.set(
        lockKey,
        lockId,
        'EX',
        ttlSeconds,
        'NX'
      ) as string | null;
      
      if (result === 'OK') {
        this.logger.info(`Lock acquired for key ${key} with ID ${lockId}`);
        return lockId;
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Error acquiring lock for key ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Release a lock using the lock ID
   */
  async release(key: string, lockId: string): Promise<boolean> {
    try {
      const lockKey = `${this.LOCK_PREFIX}${key}`;
      
      // Use Lua script to ensure we only delete if the lock ID matches
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await this.redis.eval(script, 1, lockKey, lockId);
      
      if (result === 1) {
        this.logger.info(`Lock released for key ${key}`);
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Error releasing lock for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a lock is held for the given key
   */
  async isLocked(key: string): Promise<boolean> {
    try {
      const lockKey = `${this.LOCK_PREFIX}${key}`;
      const result = await this.redis.exists(lockKey);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error checking lock for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Wait for a lock to be released (blocking)
   * Returns the lock ID if successfully acquired within timeout
   */
  async waitAndAcquire(
    key: string,
    maxWaitMs: number = 30000,
    ttlSeconds: number = this.DEFAULT_LOCK_TTL
  ): Promise<string | null> {
    const startTime = Date.now();
    const pollInterval = 100; // Poll every 100ms

    while (Date.now() - startTime < maxWaitMs) {
      const lockId = await this.acquire(key, ttlSeconds);
      if (lockId) {
        return lockId;
      }
      
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    this.logger.info(`Failed to acquire lock for key ${key} within ${maxWaitMs}ms`);
    return null;
  }

  /**
   * Get Redis instance for advanced operations
   */
  getClient(): Redis {
    return this.redis;
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (!this.redis) {
      return;
    }

    if (this.redis.status === 'end') {
      return;
    }

    try {
      await this.redis.quit();
    } catch (error: any) {
      this.logger.error(`Error closing Redis Lock connection: ${error.message}`);
      this.redis.disconnect();
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}
