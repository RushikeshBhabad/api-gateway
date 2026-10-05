import { ServiceInstance } from './ServiceInstance';
import { LoadBalancerContext } from './LoadBalancerContext';
import { LoadBalancerStrategy } from './LoadBalancerStrategy';

/**
 * Least Connections Load Balancing Strategy
 * Selects the instance with the fewest active connections.
 * It tracks connections directly on the instance object.
 */
export class LeastConnectionsStrategy implements LoadBalancerStrategy {
  public readonly name = 'LEAST_CONNECTIONS';

  /**
   * Selects the service instance with the minimum active connections.
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

    let selectedInstance = instances[0];
    let minConnections = selectedInstance.activeConnections || 0;

    for (let i = 1; i < instances.length; i++) {
      const instance = instances[i];
      const connections = instance.activeConnections || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selectedInstance = instance;
      }
    }

    // Increment active connections for the selected instance
    selectedInstance.activeConnections = (selectedInstance.activeConnections || 0) + 1;

    return selectedInstance;
  }

  /**
   * Called when a request to the instance completes.
   * Decrements the active connections count.
   *
   * @param serviceName - The name of the service.
   * @param instance - The instance that completed the request.
   */
  public onRequestComplete(serviceName: string, instance: ServiceInstance): void {
    if (instance.activeConnections && instance.activeConnections > 0) {
      instance.activeConnections -= 1;
    } else {
      instance.activeConnections = 0;
    }
  }
}
