import { ServiceInstance, parseInstanceConfig } from './ServiceInstance';
import { circuitBreakerRegistry } from '../circuitbreaker/CircuitBreakerRegistry';

export interface RegisterInstanceOptions {
  serviceName: string;
  host?: string;
  port: number;
  id?: string;
  weight?: number;
  url?: string;
}

/**
 * Manages the available service instances, automatic service discovery,
 * dynamic self-registration, heartbeats, and tracks instance health.
 */
export class ServiceRegistry {
  private services = new Map<string, ServiceInstance[]>();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor() {
    this.loadFromEnv();
  }

  /**
   * Loads service instance configurations from environment variables.
   */
  private loadFromEnv(): void {
    const serviceConfigs: Record<string, { envKey: string; fallbackUrl: string }> = {
      'user-service': { envKey: 'USER_SERVICE_INSTANCES', fallbackUrl: process.env.USER_SERVICE_URL || 'http://localhost:3001' },
      'product-service': { envKey: 'PRODUCT_SERVICE_INSTANCES', fallbackUrl: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002' },
      'order-service': { envKey: 'ORDER_SERVICE_INSTANCES', fallbackUrl: process.env.ORDER_SERVICE_URL || 'http://localhost:3003' },
    };

    for (const [name, config] of Object.entries(serviceConfigs)) {
      const instancesEnv = process.env[config.envKey];
      if (instancesEnv) {
        this.services.set(name, parseInstanceConfig(name, instancesEnv));
      } else {
        this.services.set(name, parseInstanceConfig(name, config.fallbackUrl));
      }
    }
  }

  /**
   * Registers a service instance dynamically (Self-Registration pattern).
   * If the instance already exists, updates its heartbeat and sets healthy=true.
   */
  registerInstance(options: RegisterInstanceOptions): ServiceInstance {
    const { serviceName, port } = options;
    const host = options.host || 'localhost';
    const weight = options.weight ?? 1;
    const url = options.url || `http://${host}:${port}`;
    const id = options.id || `${serviceName}-${host}-${port}`;

    if (!this.services.has(serviceName)) {
      this.services.set(serviceName, []);
    }

    const instances = this.services.get(serviceName)!;
    const existingIndex = instances.findIndex(i => i.id === id || i.url === url);

    const now = Date.now();
    if (existingIndex >= 0) {
      const existing = instances[existingIndex]!;
      existing.healthy = true;
      existing.weight = weight;
      existing.lastHeartbeat = now;
      console.info(`[ServiceRegistry] Instance re-registered / heartbeat renewed: ${id} (${url})`);
      return existing;
    }

    const newInstance: ServiceInstance = {
      id,
      host,
      port,
      url,
      weight,
      activeConnections: 0,
      healthy: true,
      lastHeartbeat: now,
      registeredAt: now,
    };

    instances.push(newInstance);
    console.info(`[ServiceRegistry] Instance registered: ${id} (${url}) for ${serviceName}. Total ${serviceName} instances: ${instances.length}`);
    return newInstance;
  }

  /**
   * Unregisters a service instance dynamically (Graceful Shutdown).
   */
  unregisterInstance(serviceName: string, instanceId: string): boolean {
    const instances = this.services.get(serviceName);
    if (!instances) return false;

    const index = instances.findIndex(i => i.id === instanceId);
    if (index >= 0) {
      instances.splice(index, 1);
      console.info(`[ServiceRegistry] Instance unregistered: ${instanceId} from ${serviceName}. Remaining: ${instances.length}`);
      return true;
    }
    return false;
  }

  /**
   * Records a heartbeat ping from an active instance.
   */
  recordHeartbeat(serviceName: string, instanceId: string): boolean {
    const instances = this.services.get(serviceName);
    if (!instances) return false;

    const instance = instances.find(i => i.id === instanceId);
    if (instance) {
      instance.lastHeartbeat = Date.now();
      if (!instance.healthy) {
        instance.healthy = true;
        console.info(`[ServiceRegistry] Instance ${instanceId} recovered via heartbeat.`);
      }
      return true;
    }
    return false;
  }

  /**
   * Gets all registered instances across all services for inspection/debugging.
   */
  getAllServices(): Record<string, ServiceInstance[]> {
    const result: Record<string, ServiceInstance[]> = {};
    for (const [name, list] of this.services.entries()) {
      result[name] = [...list];
    }
    return result;
  }

  /**
   * Gets only the healthy instances for a given service.
   * If Circuit Breaker is active, filters out OPEN circuits.
   */
  getInstances(serviceName: string): ServiceInstance[] {
    let instances = (this.services.get(serviceName) || []).filter(i => i.healthy);

    if (circuitBreakerRegistry.isEnabled()) {
      instances = instances.filter(i => circuitBreakerRegistry.get(i.id).canRequest());
    }

    return instances;
  }

  /**
   * Gets all instances (healthy and unhealthy) for a given service.
   */
  getAllInstances(serviceName: string): ServiceInstance[] {
    return this.services.get(serviceName) || [];
  }

  /**
   * Marks a specific service instance as unhealthy.
   */
  markUnhealthy(serviceName: string, instanceId: string): void {
    const instances = this.services.get(serviceName);
    if (instances) {
      const instance = instances.find(i => i.id === instanceId);
      if (instance && instance.healthy) {
        instance.healthy = false;
        console.warn(`[ServiceRegistry] Instance ${instanceId} of ${serviceName} marked UNHEALTHY.`);
      }
    }
  }

  /**
   * Marks a specific service instance as healthy.
   */
  markHealthy(serviceName: string, instanceId: string): void {
    const instances = this.services.get(serviceName);
    if (instances) {
      const instance = instances.find(i => i.id === instanceId);
      if (instance && !instance.healthy) {
        instance.healthy = true;
        console.info(`[ServiceRegistry] Instance ${instanceId} of ${serviceName} marked HEALTHY.`);
      }
    }
  }

  /**
   * Checks instances with heartbeats. If missed for over timeoutMs (default 30s),
   * mark as unhealthy.
   */
  checkHeartbeats(timeoutMs: number = 30000): void {
    const now = Date.now();
    for (const [serviceName, instances] of this.services.entries()) {
      for (const instance of instances) {
        if (instance.lastHeartbeat && (now - instance.lastHeartbeat > timeoutMs)) {
          if (instance.healthy) {
            instance.healthy = false;
            console.warn(`[ServiceRegistry] Instance ${instance.id} missed heartbeat (last: ${Math.round((now - instance.lastHeartbeat) / 1000)}s ago), marked UNHEALTHY.`);
          }
        }
      }
    }
  }

  /**
   * Starts periodic health checks and heartbeat timeout monitoring for all registered instances.
   */
  startHealthChecks(intervalMs: number = 15000): void {
    if (this.healthCheckInterval) {
      this.stopHealthChecks();
    }

    this.healthCheckInterval = setInterval(async () => {
      this.checkHeartbeats(intervalMs * 2);

      for (const [serviceName, instances] of this.services.entries()) {
        for (const instance of instances) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${instance.url}/health`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
              this.markHealthy(serviceName, instance.id);
            } else {
              this.markUnhealthy(serviceName, instance.id);
            }
          } catch (error) {
            this.markUnhealthy(serviceName, instance.id);
          }
        }
      }
    }, intervalMs);
  }

  /**
   * Stops the periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}

// Export singleton instance shared by gateway proxy and registry routes
export const serviceRegistry = new ServiceRegistry();

