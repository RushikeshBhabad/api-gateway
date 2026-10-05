import { ServiceInstance } from './ServiceInstance';
import { LoadBalancerContext } from './LoadBalancerContext';
import { LoadBalancerStrategy } from './LoadBalancerStrategy';

/**
 * Random Load Balancing Strategy
 * Selects a completely random instance from the available instances.
 */
export class RandomStrategy implements LoadBalancerStrategy {
  public readonly name = 'RANDOM';

  /**
   * Selects a random service instance.
   *
   * @param serviceName - The name of the service.
   * @param instances - Array of available service instances.
   * @param context - Optional context for the load balancer.
   * @returns The selected ServiceInstance.
   * @throws Error if instances array is empty.
   */
  public selectInstance(
    serviceName: string,
    instances: ServiceInstance[],
    context?: LoadBalancerContext
  ): ServiceInstance {
    if (!instances || instances.length === 0) {
      throw new Error(`No available instances for service: ${serviceName}`);
    }

    const randomIndex = Math.floor(Math.random() * instances.length);
    return instances[randomIndex];
  }
}
