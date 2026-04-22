import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const redisUrl =
      this.configService.get<string>("SERVER_REDIS_URL") ||
      "redis://localhost:6379";

    this.client = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: null,
    });

    this.client.on("connect", () => {
      this.logger.log(`Connected to Redis at ${redisUrl}`);
    });

    this.client.on("error", (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.quit();
      this.logger.log("Disconnected from Redis");
    }
  }

  getClient(): Redis {
    return this.client;
  }

  /**
   * Pushes a task to the specified Redis queue.
   * Uses LPUSH (so the queue workers can use BRPOP for FIFO).
   */
  async pushTask(queue: string, data: Record<string, any>): Promise<number> {
    try {
      const payload = JSON.stringify(data);
      const result = await this.client.lpush(queue, payload);
      this.logger.debug(
        `Task pushed to ${queue}: ${payload.substring(0, 100)}...`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to push task to ${queue}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Schedules a task to become visible to workers after `delaySeconds`.
   *
   * Implementation detail: payload is ZADD'ed to `<queue>:scheduled` with
   * score = Unix timestamp at which it matures. A scheduler thread living
   * inside the RPA node polls this sorted set and moves matured items to
   * the primary queue. See hanna-med-ma-rpa/core/redis_scheduler.py.
   */
  async scheduleTask(
    queue: string,
    data: Record<string, any>,
    delaySeconds: number,
  ): Promise<number> {
    try {
      const payload = JSON.stringify(data);
      const scheduledKey = `${queue}:scheduled`;
      const score = Math.floor(Date.now() / 1000) + Math.max(0, delaySeconds);
      const result = await this.client.zadd(scheduledKey, score, payload);
      this.logger.log(
        `Task scheduled on ${scheduledKey} (delay=${delaySeconds}s, score=${score})`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to schedule task on ${queue}: ${error.message}`,
      );
      throw error;
    }
  }
}
