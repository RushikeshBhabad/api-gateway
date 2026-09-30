/**
 * Strategy interface for Load Balancing traffic across multiple microservice instances.
 * Future implementations could use Round Robin, Least Connections, or IP Hash.
 */
export interface LoadBalancer {
  /**
   * Selects the next available downstream server target for a given service.
   * @param serviceName - The identifier for the target microservice pool
   * @returns The URL of the chosen server instance
   */
  getNextServer(serviceName: string): string;
}
