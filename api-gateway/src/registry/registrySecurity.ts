import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Retrieves the required internal Service Registry token.
 * Requires a dedicated SERVICE_REGISTRY_TOKEN; strictly does not fall back to JWT_SECRET.
 *
 * @returns Validated token string.
 */
export function getRegistryToken(): string {
  const token = process.env.SERVICE_REGISTRY_TOKEN;
  if (!token || !token.trim()) {
    throw new Error('FATAL: SERVICE_REGISTRY_TOKEN environment variable is required and must not be empty.');
  }
  return token.trim();
}

/**
 * Constant-time credential comparison.
 * Hashes both input tokens to fixed-size 32-byte SHA-256 digests prior to timingSafeEqual.
 * This safely eliminates any input-length RangeError crashes and completely prevents
 * timing side-channels on both token content and token length.
 *
 * @param providedToken - The token sent in the client request.
 * @param expectedToken - The secret token configured on the server.
 * @returns True if tokens match exactly, false otherwise.
 */
export function verifyRegistryToken(providedToken: string, expectedToken: string): boolean {
  if (!providedToken || !expectedToken) {
    return false;
  }
  const providedHash = crypto.createHash('sha256').update(Buffer.from(providedToken, 'utf8')).digest();
  const expectedHash = crypto.createHash('sha256').update(Buffer.from(expectedToken, 'utf8')).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

/**
 * Express middleware to authenticate both service registry mutations
 * (register, heartbeat, unregister) and sensitive registry inspection (GET /registry).
 */
export const registryAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  let expectedToken: string;
  try {
    expectedToken = getRegistryToken();
  } catch {
    res.status(500).json({
      success: false,
      error: 'Service registry authentication is misconfigured on the Gateway.'
    });
    return;
  }

  // Support both custom header (x-registry-token) and standard Authorization header
  const customHeader = req.headers['x-registry-token'];
  const authHeader = req.headers['authorization'];
  let providedToken: string | null = null;

  if (typeof customHeader === 'string' && customHeader.trim()) {
    providedToken = customHeader.trim();
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  }

  if (!providedToken) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Service registry authentication token is required.'
    });
    return;
  }

  if (!verifyRegistryToken(providedToken, expectedToken)) {
    res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid service registry authentication token.'
    });
    return;
  }

  next();
};
