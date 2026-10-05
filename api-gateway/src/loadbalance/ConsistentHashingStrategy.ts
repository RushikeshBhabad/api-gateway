import { ServiceInstance } from './ServiceInstance';
import { LoadBalancerContext } from './LoadBalancerContext';
import { LoadBalancerStrategy } from './LoadBalancerStrategy';

/**
 * Represents a virtual node on the consistent hash ring.
 */
interface VirtualNode {
  hash: number;
  instance: ServiceInstance;
}

/**
 * Consistent Hashing Load Balancing Strategy
 * Maps instances to a hash ring using virtual nodes to ensure even distribution.
 * Selects instances based on a request key derived from context.
 */
export class ConsistentHashingStrategy implements LoadBalancerStrategy {
  public readonly name = 'CONSISTENT_HASHING';

  private readonly virtualNodes: number;
  // Map of serviceName -> array of virtual nodes (the ring)
  private readonly rings: Map<string, VirtualNode[]> = new Map();
  // Map of serviceName -> comma separated list of instance IDs to detect changes
  private readonly instanceIdsCache: Map<string, string> = new Map();

  constructor() {
    this.virtualNodes = parseInt(process.env.VIRTUAL_NODES || '150', 10);
  }

  /**
   * Implements the DJB2 hash algorithm for string hashing.
   *
   * @param str - The string to hash.
   * @returns The 32-bit integer hash.
   */
  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    // Force to positive 32-bit integer
    return hash >>> 0;
  }

  /**
   * Determines the request key from the load balancer context.
   * Priority: userId > clientIp > requestPath > 'default'
   *
   * @param context - The request context.
   * @returns The request key.
   */
  private getRequestKey(context?: LoadBalancerContext): string {
    if (!context) return 'default';
    if (context.userId) return context.userId;
    if (context.clientIp) return context.clientIp;
    if (context.requestPath) return context.requestPath;
    return 'default';
  }

  /**
   * Rebuilds the hash ring for a given service.
   *
   * @param serviceName - The name of the service.
   * @param instances - The available service instances.
   */
  private rebuildRing(serviceName: string, instances: ServiceInstance[]): void {
    const ring: VirtualNode[] = [];
    
    for (const instance of instances) {
      for (let i = 0; i < this.virtualNodes; i++) {
        const vNodeKey = `${instance.id}-vnode-${i}`;
        const hash = this.hashString(vNodeKey);
        ring.push({ hash, instance });
      }
    }

    // Sort the ring by hash value ascending
    ring.sort((a, b) => a.hash - b.hash);
    this.rings.set(serviceName, ring);
  }

  /**
   * Checks if the instances have changed by comparing sorted IDs.
   *
   * @param serviceName - The name of the service.
   * @param instances - The current service instances.
   * @returns True if instances changed, false otherwise.
   */
  private hasInstancesChanged(serviceName: string, instances: ServiceInstance[]): boolean {
    const currentIds = instances.map(i => i.id).sort().join(',');
    const cachedIds = this.instanceIdsCache.get(serviceName);
    
    if (currentIds !== cachedIds) {
      this.instanceIdsCache.set(serviceName, currentIds);
      return true;
    }
    return false;
  }

  /**
   * Selects an instance from the hash ring using binary search.
   *
   * @param ring - The sorted array of virtual nodes.
   * @param hash - The hash of the request key.
   * @returns The selected service instance.
   */
  private findInstance(ring: VirtualNode[], hash: number): ServiceInstance {
    let low = 0;
    let high = ring.length - 1;
    let index = 0;

    // Binary search for the first node with hash >= request hash
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (ring[mid].hash >= hash) {
        index = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // Wrap around if the hash is greater than the last node's hash
    if (low > ring.length - 1) {
      index = 0;
    }

    return ring[index].instance;
  }

  /**
   * Selects a service instance using consistent hashing based on a request key.
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

    // Rebuild ring if instances have changed or ring doesn't exist
    if (!this.rings.has(serviceName) || this.hasInstancesChanged(serviceName, instances)) {
      this.rebuildRing(serviceName, instances);
    }

    const ring = this.rings.get(serviceName)!;
    const requestKey = this.getRequestKey(context);
    const hash = this.hashString(requestKey);

    // Logging the hash key used
    console.info(`[ConsistentHashingStrategy] service=${serviceName}, key=${requestKey}, hash=${hash}`);

    return this.findInstance(ring, hash);
  }
}
