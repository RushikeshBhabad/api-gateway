// Handles both authentication and authorization for all /api requests. 
import { Request, Response, NextFunction } from 'express';
import { JWTAuthentication } from '../authentication/JWTAuthentication';
import { RBACAuthorization } from '../authorization/RBACAuthorization';

const authStrategy = new JWTAuthentication();
const authzStrategy = new RBACAuthorization();

// Define routes that do not require authentication
const PUBLIC_ROUTES = [
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/signup' },
  { method: 'POST', path: '/auth/refresh' }
];

/**
 * Global authentication and authorization middleware.
 * Intercepts all /api requests, verifies JWTs, enforces Role-Based Access Control,
 * and attaches user context headers for downstream microservices.
 * 
 * @param req - Express Request object
 * @param res - Express Response object
 * @param next - Express Next function
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const path = req.path.replace(/\/$/, ""); 
  
  // Check if route matches PUBLIC_ROUTES
  const isPublic = PUBLIC_ROUTES.some(r => r.method === req.method && (path === r.path || (r.path === '/products' && path.startsWith('/products'))));
  
  // Allow public access to all GET /products routes
  if (isPublic && req.method === 'GET' && path.startsWith('/products')) {
     next();
     return;
  }

  // Allow Google OAuth redirect and callback routes
  if (path.startsWith('/auth/google')) {
      next();
      return;
  }

  // Allow explicitly defined public auth routes
  if (isPublic && path.startsWith('/auth')) {
      next();
      return;
  }
  
  // Secondary check for public products GET
  if (req.method === 'GET' && path.startsWith('/products')) {
      next();
      return;
  }

  // Attempt to authenticate request using the chosen strategy
  const authContext = await authStrategy.authenticate(req);
  
  if (!authContext) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' }, requestId: req.headers['x-request-id'] });
    return;
  }

  // Attempt to authorize the request using RBAC strategy
  if (!authzStrategy.authorize(authContext.role, req.method, path)) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }, requestId: req.headers['x-request-id'] });
    return;
  }

  // Attach context to headers for proxy forwarding
  req.headers['x-user-id'] = authContext.userId;
  req.headers['x-user-role'] = authContext.role;

  next();
};
