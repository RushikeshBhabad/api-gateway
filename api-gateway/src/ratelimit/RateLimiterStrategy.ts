export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

/**
 * The Strategy interface. Any custom algorithm must implement this.
 */
export interface RateLimiterStrategy {
  isAllowed(key: string): Promise<RateLimitResult>;
}
