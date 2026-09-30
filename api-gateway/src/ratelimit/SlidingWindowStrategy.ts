import { RateLimiterStrategy, RateLimitResult } from './RateLimiterStrategy';

export class SlidingWindowStrategy implements RateLimiterStrategy {
  private limit: number;
  private windowMs: number;
  private logs = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async isAllowed(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    let timestamps = this.logs.get(key) || [];
    
    // Remove timestamps older than the window
    timestamps = timestamps.filter(ts => ts > windowStart);
    
    if (timestamps.length < this.limit) {
      timestamps.push(now);
      this.logs.set(key, timestamps);
      return { allowed: true, remaining: this.limit - timestamps.length };
    }
    
    this.logs.set(key, timestamps);
    const oldestTimestamp = timestamps[0];
    const retryAfterMs = this.windowMs - (now - oldestTimestamp);
    
    return { allowed: false, remaining: 0, retryAfterMs };
  }
}
