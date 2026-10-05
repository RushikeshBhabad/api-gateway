import { ServiceInstance } from './ServiceInstance';
import { LoadBalancerContext } from './LoadBalancerContext';

/**
 * Interface defining the strategy pattern for load balancing requests
 * across multiple service instances.
 */
export interface LoadBalancerStrategy {
  /**
   * The name of the strategy (e.g., 'ROUND_ROBIN').
   */
  readonly name: string;

  /**
   * Selects a single instance from a list of available instances.
   * 
   * @param serviceName - The name of the service being requested.
   * @param instances - An array of available service instances.
   * @param context - Optional context about the current request.
   * @returns The selected ServiceInstance.
   */
  selectInstance(
    serviceName: string,
    instances: ServiceInstance[],
    context?: LoadBalancerContext
  ): ServiceInstance;
  
  /**
   * Optional callback triggered when a request completes.
   * Useful for strategies like Least Connections that need to track active requests.
   * 
   * @param serviceName - The name of the service.
   * @param instance - The instance that handled the request.
   */
  onRequestComplete?(serviceName: string, instance: ServiceInstance): void;
}
