import { LoadBalancerStrategy } from './LoadBalancerStrategy';
import { ServiceInstance } from './ServiceInstance';
import { LoadBalancerContext } from './LoadBalancerContext';

/**
 * State to keep track of the current weight for a service instance.
 */
interface InstanceWeightState {
  currentWeight: number;
}

/**
 * A Smooth Weighted Round Robin load balancing strategy.
 * Implements the Nginx smooth weighted round-robin algorithm to ensure
 * even distribution of requests without clustering them to a single high-weight instance.
 */
export class WeightedRoundRobinStrategy implements LoadBalancerStrategy {
  public readonly name: string = 'WEIGHTED_ROUND_ROBIN';

  /**
   * State map keyed by service name, mapping to another map of instance IDs to their weight state.
   */
  private readonly state: Map<string, Map<string, InstanceWeightState>> = new Map();

  /**
   * Selects an instance using the Smooth Weighted Round Robin algorithm.
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

    let serviceState = this.state.get(serviceName);
    if (!serviceState) {
      serviceState = new Map<string, InstanceWeightState>();
      this.state.set(serviceName, serviceState);
    }

    let totalWeight = 0;
    let selectedInstance: ServiceInstance | null = null;
    let maxCurrentWeight = Number.MIN_SAFE_INTEGER;

    for (const instance of instances) {
      // Use instance.weight, defaulting to 1 if not present
      const weight = instance.weight ?? 1;
      totalWeight += weight;

      let instanceState = serviceState.get(instance.id);
      if (!instanceState) {
        instanceState = { currentWeight: 0 };
        serviceState.set(instance.id, instanceState);
      }

      // 1. Add weight to each instance's currentWeight
      instanceState.currentWeight += weight;

      // 2. Select instance with highest currentWeight
      if (selectedInstance === null || instanceState.currentWeight > maxCurrentWeight) {
        selectedInstance = instance;
        maxCurrentWeight = instanceState.currentWeight;
      }
    }

    if (!selectedInstance) {
      throw new Error(`Failed to select an instance for service: ${serviceName}`);
    }

    // 3. Subtract totalWeight from the selected instance's currentWeight
    const selectedState = serviceState.get(selectedInstance.id)!;
    selectedState.currentWeight -= totalWeight;

    // Clean up states for instances that are no longer present to avoid memory leaks
    if (serviceState.size > instances.length) {
      const currentIds = new Set(instances.map(inst => inst.id));
      for (const id of serviceState.keys()) {
        if (!currentIds.has(id)) {
          serviceState.delete(id);
        }
      }
    }

    return selectedInstance;
  }
}
