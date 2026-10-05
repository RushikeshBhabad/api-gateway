import { LoadBalancerStrategy } from './LoadBalancerStrategy';
import { ServiceInstance } from './ServiceInstance';
import { LoadBalancerContext } from './LoadBalancerContext';

/**
 * A Round Robin load balancing strategy.
 * This strategy maintains a per-service counter to sequentially route requests
 * to the available service instances in a cyclic manner.
 */
export class RoundRobinStrategy implements LoadBalancerStrategy {
  public readonly name: string = 'ROUND_ROBIN';

  /**
   * Tracks the current index for each service to ensure round-robin distribution
   * happens independently per service.
   */
  private readonly counters: Map<string, number> = new Map<string, number>();

  /**
   * Selects an instance using the Round Robin algorithm.
   *
   * @param serviceName - The name of the service for which to select an instance.
   * @param instances - The list of available service instances.
   * @param context - Optional context about the load balancer request.
   * @returns The selected ServiceInstance.
   * @throws {Error} If no instances are provided.
   */
  public selectInstance(
    serviceName: string,
    instances: ServiceInstance[],
    context?: LoadBalancerContext
  ): ServiceInstance {
    if (!instances || instances.length === 0) {
      throw new Error(`No instances available for service: ${serviceName}`);
    }

    const counter = this.counters.get(serviceName) || 0;
    const instance = instances[counter % instances.length];
    
    // Increment the counter and wrap around safely
    this.counters.set(serviceName, (counter + 1) % instances.length);

    return instance;
  }
}
