import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import { setupProxies } from './proxy';
import { authMiddleware } from './middleware/authMiddleware';

dotenv.config({ path: '../.env' });

const app = express();

// Basic security headers
app.use(helmet());

// Cross-Origin Resource Sharing configuration
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));

// Cookie parsing for JWT refresh tokens
app.use(cookieParser());

/**
 * Middleware: Generates a unique X-Request-ID for every incoming request.
 * Useful for distributed tracing across microservices.
 */
app.use((req, res, next) => {
  const reqId = uuidv4();
  req.headers['x-request-id'] = reqId;
  res.setHeader('X-Request-ID', reqId);
  next();
});

// --- Import our custom Strategy-based Rate Limiters ---
import { rateLimiter } from './ratelimit/rateLimitMiddleware';
import { TokenBucketStrategy } from './ratelimit/TokenBucketStrategy';
import { SlidingWindowStrategy } from './ratelimit/SlidingWindowStrategy';
import { FixedWindowStrategy } from './ratelimit/FixedWindowStrategy';

/**
 * Route: Basic health check endpoint.
 */
app.get('/health', (req, res) => res.status(200).json({ status: 'GATEWAY_UP' }));

// --- Apply Dynamic Strategy Rate Limiting ---
// You can seamlessly swap these algorithms dynamically based on your preference!

// 1. Sliding Window for Auth Routes (Strict: 5 attempts per 60 seconds)
// Prevents brute force credential stuffing at exact window boundaries
app.use('/api/auth', rateLimiter(new SlidingWindowStrategy(20, 60000)));

// 2. Token Bucket for Orders (Allows bursts: 10 capacity, refills 1 token per second)
// Perfect for checkout processes where users might click rapidly
app.use('/api/orders', rateLimiter(new TokenBucketStrategy(11, 1)));

// 3. Fixed Window for everything else (Generic: 100 requests per 60 seconds)
app.use('/api', rateLimiter(new FixedWindowStrategy(100, 60000)));


// Apply authentication and authorization middleware to all /api routes
app.use('/api', authMiddleware);

// Setup http-proxy-middleware routes
setupProxies(app);

/**
 * Global Error Handler middleware.
 */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred'
    },
    requestId: req.headers['x-request-id']
  });
});

const PORT = process.env.PORT_GATEWAY || 8000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
