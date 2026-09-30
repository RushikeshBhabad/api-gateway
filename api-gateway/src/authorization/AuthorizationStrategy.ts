/**
 * Strategy interface for authorizing a request after it has been authenticated.
 * Allows plug-and-play implementations (e.g., RBAC, ABAC, ACL).
 */
export interface AuthorizationStrategy {
  /**
   * Evaluates whether the given role is permitted to execute the HTTP method on the specified path.
   * @param role - The authenticated user's role (e.g., 'ADMIN', 'USER')
   * @param method - The HTTP method requested (e.g., 'GET', 'POST')
   * @param path - The requested route path
   * @returns true if authorized, false otherwise.
   */
  authorize(role: string, method: string, path: string): boolean;
}
