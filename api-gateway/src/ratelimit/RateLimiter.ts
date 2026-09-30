import { Request } from 'express';

/**
 * Strategy interface for API Gateway Rate Limiting.
 * Future implementations could use Token Bucket, Sliding Window, or Redis-backed logic.
 */
export interface RateLimiter {
  /**
   * Checks if the incoming request exceeds the configured rate limit.
   * @param req - Express Request object
   * @returns A promise that resolves to true if allowed, false if limit exceeded.
   */
  isAllowed(req: Request): Promise<boolean>;
}
