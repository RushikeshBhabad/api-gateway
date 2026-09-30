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
    try {
      const secret = process.env.JWT_SECRET || 'super_secret_jwt_key_for_this_project_123';
      const decoded = jwt.verify(token, secret) as any;
      return {
        userId: decoded.sub,
        role: decoded.role
      };
    } catch (err: any) {
      console.error('JWT Verification Error in Gateway:', err.message);
      return null;
    }
  }
}
