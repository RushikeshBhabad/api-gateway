import { Request } from 'express';

/**
 * Context provided to the load balancer strategy for making routing decisions.
 * Some algorithms need information about the request.
 * For example, Consistent Hashing needs a key.
 * It can use:
 * - userId
 */
export interface LoadBalancerContext {
  req?: Request;
  clientIp?: string;
  userId?: string;
  requestPath?: string;
}
