import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { LoggerService } from '../../common/provider';

@Injectable()
export class RedisCache {
  private redis: Redis;

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
      this.logger.error(`Redis Cache Error: ${err.message}`, err.stack);
    });

    this.redis.on('connect', () => {
      this.logger.info('Redis Cache connected successfully');
    });
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.info(`Error getting cache for key ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Set value in cache with optional TTL (in seconds)
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (error) {
      this.logger.info(`Error setting cache for key ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Delete cache key
   */
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.info(`Error deleting cache for key ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.info(`Error checking cache existence for key ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Clear all cache
   */
  async flush(): Promise<void> {
    try {
      await this.redis.flushdb();
    } catch (error) {
      this.logger.info(`Error flushing cache: ${(error as Error).message}`);
    }
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
    await this.redis.quit();
  }
}
