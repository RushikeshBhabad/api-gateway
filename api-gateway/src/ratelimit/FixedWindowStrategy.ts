import { RateLimiterStrategy, RateLimitResult } from './RateLimiterStrategy';

export class FixedWindowStrategy implements RateLimiterStrategy {
  private limit: number;
  private windowMs: number;
  private counters = new Map<string, { count: number; windowStart: number }>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async isAllowed(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    let counter = this.counters.get(key);

    // Reset window if it has expired
    if (!counter || now - counter.windowStart >= this.windowMs) {
      counter = { count: 0, windowStart: now };
    }

    if (counter.count < this.limit) {
      counter.count += 1;
      this.counters.set(key, counter);
      return { allowed: true, remaining: this.limit - counter.count };
    }

    const retryAfterMs = this.windowMs - (now - counter.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
}
