import { AuthorizationStrategy } from './AuthorizationStrategy';

/**
 * Implementation of AuthorizationStrategy that uses Role-Based Access Control (RBAC).
 * Defines rules that map roles to allowed HTTP methods and route patterns.
 */
export class RBACAuthorization implements AuthorizationStrategy {

  private rules: Record<string, { methods: string[], routePattern: RegExp }[]> = {
    ADMIN: [
      { methods: ['GET', 'POST', 'PUT', 'DELETE'], routePattern: /.*/ } // Admin can do anything
    ],
    USER: [
      { methods: ['GET'], routePattern: /^\/products/ }, // Can read products
      { methods: ['GET', 'PUT'], routePattern: /^\/users\/me/ }, // Can manage own profile
      { methods: ['POST', 'GET'], routePattern: /^\/orders/ }, // Can place and view orders
      { methods: ['POST'], routePattern: /^\/auth\/logout/ } // Can log out
    ]
  };

  /**
   * Checks if the user's role matches any defined RBAC rules allowing the requested action.
   * @param role - The user's role
   * @param method - The requested HTTP method
   * @param path - The requested path
   * @returns boolean indicating authorization success
   */
  authorize(role: string, method: string, path: string): boolean {
    const roleRules = this.rules[role];
    if (!roleRules) return false;

    for (const rule of roleRules) {
      if (rule.methods.includes(method) && rule.routePattern.test(path)) {
        return true;
      }
    }
    
    return false;
  }
}
