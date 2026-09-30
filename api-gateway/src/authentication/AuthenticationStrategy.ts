import { Request } from 'express';

/**
 * Interface representing the extracted context from a successfully authenticated request.
 */
export interface AuthenticationContext {
  userId: string;
  role: string;
}

/**
 * Strategy interface for authenticating incoming API Gateway requests.
 * Allows plug-and-play implementations (e.g., JWT, OAuth2, API Keys).
 */
export interface AuthenticationStrategy {
  /**
   * Authenticates the request.
   * @param req - Express Request object
   * @returns A promise that resolves to an AuthenticationContext if valid, or null if invalid.
   */
  authenticate(req: Request): Promise<AuthenticationContext | null>;
}
