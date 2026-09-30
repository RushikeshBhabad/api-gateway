import { Request, Response, NextFunction } from 'express';
import { RateLimiterStrategy } from './RateLimiterStrategy';

/**
 * Universal middleware that accepts ANY RateLimiterStrategy.
 * You can mix and match strategies dynamically!
 */
export const rateLimiter = (strategy: RateLimiterStrategy) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Identify user by IP (or user ID if authenticated)
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    
    const result = await strategy.isAllowed(key);
    
    if (!result.allowed) {
       res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded.',
          retryAfterMs: result.retryAfterMs
        }
      });
      return;
    }
    
    // Attach remaining limit to headers for client awareness
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    next();
  };
};
