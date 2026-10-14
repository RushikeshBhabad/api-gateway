import { Request } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { AuthenticationStrategy, AuthenticationContext } from './AuthenticationStrategy';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Implementation of AuthenticationStrategy that verifies JSON Web Tokens (JWT)
 * extracted from the 'Authorization: Bearer <token>' header.
 */
export class JWTAuthentication implements AuthenticationStrategy {
  /**
   * Extracts and verifies the JWT.
   * @param req - Express Request object containing the Authorization header.
   * @returns A promise that resolves to AuthenticationContext (userId and role) or null on failure.
   */
  async authenticate(req: Request): Promise<AuthenticationContext | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      return null;
    }
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret || !secret.trim()) {
        console.error('JWT Verification Error in Gateway: JWT_SECRET environment variable is required and must not be empty.');
        return null;
      }
      // Restrict explicitly to HMAC-SHA256 (prevents algorithm confusion attacks e.g. "none" or asymmetric keys)
      const decoded = jwt.verify(token, secret.trim(), {
        algorithms: ['HS256']
      }) as any;

      // Validate presence and types of required claims
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        typeof decoded.sub !== 'string' ||
        !decoded.sub.trim() ||
        typeof decoded.role !== 'string' ||
        !decoded.role.trim()
      ) {
        console.error('JWT Verification Error in Gateway: Token is missing required claims (sub, role).');
        return null;
      }

      return {
        userId: decoded.sub.trim(),
        role: decoded.role.trim()
      };
    } catch (err: any) {
      console.error('JWT Verification Error in Gateway:', err.message);
      return null;
    }
  }
}
