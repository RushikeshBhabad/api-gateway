import { RateLimiterStrategy, RateLimitResult } from './RateLimiterStrategy';

export class TokenBucketStrategy implements RateLimiterStrategy {
  private capacity: number;
  private refillRatePerSec: number;
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(capacity: number, refillRatePerSec: number) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
  }

  async isAllowed(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key) || { tokens: this.capacity, lastRefill: now };

    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillRatePerSec);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { allowed: true, remaining: Math.floor(bucket.tokens) };
    }

    return { allowed: false, remaining: 0, retryAfterMs: 1000 };
  }
}
