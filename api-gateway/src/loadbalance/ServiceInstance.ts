/**
 * Represents a single instance of a service.
 */
export interface ServiceInstance {
  id: string;                // e.g. 'user-service-3001'
  host: string;              // e.g. 'localhost'
  port: number;              // e.g. 3001
  url: string;               // e.g. 'http://localhost:3001'
  weight: number;            // default 1, used for Weighted RR
  activeConnections: number; // tracked for Least Connections
  healthy: boolean;          // health status
}

/**
 * Parses a configuration string into an array of ServiceInstances.
 * 
 * @param serviceName - The name of the service (e.g., 'user-service')
 * @param config - A comma-separated string of URLs, optionally with weights.
 *                 Format: 'http://host:port' or 'http://host:port:weight'
 * @returns An array of ServiceInstance objects.
 */
export function parseInstanceConfig(serviceName: string, config: string): ServiceInstance[] {
  if (!config) {
    return [];
  }

  return config.split(',').map((urlStr) => {
    const trimmed = urlStr.trim();
    
    // Default protocol fallback
    const protocolMatch = trimmed.match(/^(https?:\/\/)/);
    const protocol = protocolMatch ? protocolMatch[1] : 'http://';
    const rest = protocolMatch ? trimmed.slice(protocolMatch[1].length) : trimmed;
    
    // Split the remaining host:port:weight
    const parts = rest.split(':');
    const host = parts[0];
    let port = 80;
    let weight = 1;

    if (parts.length === 2) {
      port = parseInt(parts[1], 10);
    } else if (parts.length === 3) {
      port = parseInt(parts[1], 10);
      weight = parseInt(parts[2], 10);
    }

    const validPort = isNaN(port) ? 80 : port;
    const validWeight = isNaN(weight) ? 1 : weight;
    const url = `${protocol}${host}${parts.length >= 2 ? `:${validPort}` : ''}`;
    const id = `${serviceName}-${host}-${validPort}`;

    return {
      id,
      host,
      port: validPort,
      url,
      weight: validWeight,
      activeConnections: 0,
      healthy: true,
    };
  });
}
