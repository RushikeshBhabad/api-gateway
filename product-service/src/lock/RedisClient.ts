import Redis from 'ioredis';

let sharedRedisClient: Redis | null = null;
let isConnected = false;

/**
 * Returns a shared singleton Redis client instance.
 * Reuses the existing connection rather than opening connections per request.
 */
export function getRedisClient(): Redis {
  if (sharedRedisClient) {
    return sharedRedisClient;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  sharedRedisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 1, // Don't hang indefinitely on command failure
    connectTimeout: 5000,
    retryStrategy(times) {
      // Bounded exponential backoff: 50ms, 100ms, ..., max 2000ms
      const delay = Math.min(times * 100, 2000);
      return delay;
    },
    lazyConnect: false,
    enableReadyCheck: true,
  });

  sharedRedisClient.on('connect', () => {
    isConnected = true;
    console.log('[Redis] Connected to Redis server.');
  });

  sharedRedisClient.on('ready', () => {
    isConnected = true;
    console.log('[Redis] Redis client ready.');
  });

  sharedRedisClient.on('error', (err) => {
    isConnected = false;
    // Log meaningful message without credentials
    console.error(`[Redis] Connection error: ${err.message}`);
  });

  sharedRedisClient.on('close', () => {
    isConnected = false;
    console.warn('[Redis] Connection closed.');
  });

  return sharedRedisClient;
}

/**
 * Checks whether the shared Redis client is currently connected and ready.
 */
export function isRedisConnected(): boolean {
  return isConnected && sharedRedisClient !== null && sharedRedisClient.status === 'ready';
}

/**
 * Closes the shared Redis connection gracefully.
 */
export async function closeRedisClient(): Promise<void> {
  if (sharedRedisClient) {
    try {
      await sharedRedisClient.quit();
    } catch {
      sharedRedisClient.disconnect();
    } finally {
      sharedRedisClient = null;
      isConnected = false;
    }
  }
}

