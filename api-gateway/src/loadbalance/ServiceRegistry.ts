import { ServiceInstance, parseInstanceConfig } from './ServiceInstance';
import { circuitBreakerRegistry } from '../circuitbreaker/CircuitBreakerRegistry';

/**
 * Manages the available service instances and tracks their health.
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
    // Read from env:
    // USER_SERVICE_INSTANCES=http://localhost:3001,http://localhost:3011,http://localhost:3021
    // 
    // Fallback to legacy single-instance env vars if *_INSTANCES is not set
    
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
   * Gets only the healthy instances for a given service.
   * 
   * @param serviceName - The name of the service.
   * @returns An array of healthy ServiceInstances.
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
   * 
   * @param serviceName - The name of the service.
   * @returns An array of all ServiceInstances.
   */
  getAllInstances(serviceName: string): ServiceInstance[] {
    return this.services.get(serviceName) || [];
  }

  /**
   * Marks a specific service instance as unhealthy.
   * 
   * @param serviceName - The name of the service.
   * @param instanceId - The ID of the instance to mark unhealthy.
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
   * 
   * @param serviceName - The name of the service.
   * @param instanceId - The ID of the instance to mark healthy.
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
   * Starts periodic health checks for all registered instances.
   * Lightweight health check using fetch to /health
   * 
   * @param intervalMs - The interval in milliseconds between health checks (default 15000ms).
   */
  startHealthChecks(intervalMs: number = 15000): void {
    if (this.healthCheckInterval) {
      this.stopHealthChecks();
    }

    this.healthCheckInterval = setInterval(async () => {
      for (const [serviceName, instances] of this.services.entries()) {
        for (const instance of instances) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
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
