import { RateLimiterStrategy, RateLimitResult } from './RateLimiterStrategy';

/**
 * Leaky Bucket Algorithm Strategy:
 * - Requests enter the bucket.
 * - The bucket leaks at a constant outflow rate (leakRatePerSec).
 * - If the bucket overflows (waterLevel exceeds capacity), requests are dropped (HTTP 429).
 * - Ideal for traffic smoothing and protecting sensitive downstream databases.
 */
export class LeakyBucketStrategy implements RateLimiterStrategy {
  private capacity: number;
  private leakRatePerSec: number;
  private buckets = new Map<string, { water: number; lastLeak: number }>();

  /**
   * @param capacity - Maximum buffer/queue size of the bucket (e.g. 10 requests).
   * @param leakRatePerSec - Number of requests processed/leaked per second (e.g. 2 per sec).
   */
  constructor(capacity: number, leakRatePerSec: number) {
    this.capacity = capacity;
    this.leakRatePerSec = leakRatePerSec;
  }

  async isAllowed(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key) || { water: 0, lastLeak: now };

    // 1. Calculate the water leaked since last request
    const elapsedSec = (now - bucket.lastLeak) / 1000;
    const leaked = elapsedSec * this.leakRatePerSec;

    // 2. Leak the water out of the bucket
    bucket.water = Math.max(0, bucket.water - leaked);
    bucket.lastLeak = now;

    // 3. Check if there is capacity for 1 more drop/request
    if (bucket.water < this.capacity) {
      bucket.water += 1;
      this.buckets.set(key, bucket);
      
      const remainingCapacity = Math.max(0, Math.floor(this.capacity - bucket.water));
      return {
        allowed: true,
        remaining: remainingCapacity
      };
    }

    // 4. Bucket is full (Overflow / Rate Limit Exceeded)
    this.buckets.set(key, bucket);
    const overflow = bucket.water - this.capacity + 1;
    const retryAfterMs = Math.ceil((overflow / this.leakRatePerSec) * 1000);

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs
    };
  }
}
