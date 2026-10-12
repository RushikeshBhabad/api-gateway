import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { getRedisClient } from './RedisClient';

export class RedisUnavailableError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'SERVICE_UNAVAILABLE';

  constructor(message: string = 'Redis service unavailable for distributed locking') {
    super(message);
    this.name = 'RedisUnavailableError';
  }
}

export class LockAcquisitionTimeoutError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'LOCK_ACQUISITION_TIMEOUT';

  constructor(resourceKey: string, timeoutMs: number) {
    super(`Could not acquire distributed lock for resource '${resourceKey}' within ${timeoutMs}ms`);
    this.name = 'LockAcquisitionTimeoutError';
  }
}

export interface LockOptions {
  ttlMs?: number;        // Lease duration in ms (default 5000)
  timeoutMs?: number;    // Max wait/retry time in ms (default 3000)
  retryDelayMs?: number; // Base delay between retries in ms (default 50)
}

export interface LockHandle {
  resourceKey: string;
  lockKey: string;
  token: string;
  ttlMs: number;
  leaseExpiresAt: number;
  extend: (ttlMs?: number) => Promise<boolean>;
  release: () => Promise<boolean>;
}

const RELEASE_LUA_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

const EXTEND_LUA_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], tonumber(ARGV[2]))
else
    return 0
end
`;

/**
 * Reusable Redis Distributed Lock implementation.
 * Provides mutual exclusion using atomic SET NX PX and token-validated Lua release/extension.
 */
export class RedisDistributedLock {
  private client: Redis;

  constructor(client?: Redis) {
    this.client = client || getRedisClient();
  }

  /**
   * Generates the scoped Redis key for the locked resource.
   */
  public getLockKey(resourceKey: string): string {
    return resourceKey.startsWith('lock:') ? resourceKey : `lock:${resourceKey}`;
  }

  /**
   * Attempts to acquire a distributed lock. Retries with bounded backoff until acquired
   * or until timeoutMs is reached.
   *
   * @param resourceKey The target resource to lock (e.g., 'inventory:product:123')
   * @param options Configuration for lease duration, wait timeout, and retry delay
   */
  public async acquireLock(resourceKey: string, options?: LockOptions): Promise<LockHandle> {
    const ttlMs = options?.ttlMs ?? parseInt(process.env.REDIS_LOCK_TTL_MS || '5000', 10);
    const timeoutMs = options?.timeoutMs ?? parseInt(process.env.REDIS_LOCK_TIMEOUT_MS || '3000', 10);
    const retryDelayMs = options?.retryDelayMs ?? parseInt(process.env.REDIS_LOCK_RETRY_DELAY_MS || '50', 10);

    const lockKey = this.getLockKey(resourceKey);
    const token = uuidv4();
    const startTime = Date.now();

    while (true) {
      try {
        // Atomic SET with NX (only if key does not exist) and PX (millisecond TTL)
        const acquired = await this.client.set(lockKey, token, 'PX', ttlMs, 'NX');

        if (acquired === 'OK') {
          const leaseExpiresAt = Date.now() + ttlMs;

          const handle: LockHandle = {
            resourceKey,
            lockKey,
            token,
            ttlMs,
            leaseExpiresAt,
            extend: (newTtlMs?: number) => this.extendLock(resourceKey, token, newTtlMs ?? ttlMs),
            release: () => this.releaseLock(resourceKey, token),
          };

          return handle;
        }
      } catch (err: any) {
        // If Redis is unreachable or rejects commands, fail fast with controlled 503 error
        console.error(`[RedisDistributedLock] Redis error while acquiring lock for '${lockKey}':`, err.message);
        throw new RedisUnavailableError(`Failed to contact distributed lock service: ${err.message}`);
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        throw new LockAcquisitionTimeoutError(resourceKey, timeoutMs);
      }

      // Bounded backoff with jitter to avoid lock thundering herds
      const jitter = Math.floor(Math.random() * 20);
      const sleepTime = Math.min(retryDelayMs + jitter, timeoutMs - elapsed);
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, sleepTime)));
    }
  }

  /**
   * Safely releases the lock ONLY if the token matches the current owner.
   * Uses an atomic Lua script to prevent deleting locks re-acquired after lease expiration.
   */
  public async releaseLock(resourceKey: string, lockToken: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const result = await this.client.eval(RELEASE_LUA_SCRIPT, 1, lockKey, lockToken);
      const released = result === 1;

      if (!released) {
        console.warn(`[RedisDistributedLock] Lock '${lockKey}' not released (token mismatch or already expired)`);
      }
      return released;
    } catch (err: any) {
      console.error(`[RedisDistributedLock] Redis error while releasing lock '${lockKey}':`, err.message);
      throw new RedisUnavailableError(`Failed to release lock due to Redis error: ${err.message}`);
    }
  }

  /**
   * Extends the lease of an existing lock ONLY if the caller still owns the token.
   */
  public async extendLock(resourceKey: string, lockToken: string, ttlMs: number): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const result = await this.client.eval(EXTEND_LUA_SCRIPT, 1, lockKey, lockToken, ttlMs.toString());
      const extended = result === 1;

      if (!extended) {
        console.warn(`[RedisDistributedLock] Lock '${lockKey}' lease extension failed (token mismatch or expired)`);
      }
      return extended;
    } catch (err: any) {
      console.error(`[RedisDistributedLock] Redis error extending lock '${lockKey}':`, err.message);
      throw new RedisUnavailableError(`Failed to extend lock due to Redis error: ${err.message}`);
    }
  }

  /**
   * Helper to execute an async critical section wrapped in acquire/release.
   * Guarantees release in a finally block.
   */
  public async withLock<T>(
    resourceKey: string,
    fn: (handle: LockHandle) => Promise<T>,
    options?: LockOptions
  ): Promise<T> {
    const handle = await this.acquireLock(resourceKey, options);
    try {
      return await fn(handle);
    } finally {
      await handle.release().catch((err) => {
        console.error(`[RedisDistributedLock] Error releasing lock in withLock for '${resourceKey}':`, err.message);
      });
    }
  }
}

export const distributedLock = new RedisDistributedLock();
