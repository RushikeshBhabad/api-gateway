import { Request } from 'express';

/**
 * Context provided to the load balancer strategy for making routing decisions.
 */
export interface LoadBalancerContext {
  req?: Request;
  clientIp?: string;
  userId?: string;
  requestPath?: string;
}
