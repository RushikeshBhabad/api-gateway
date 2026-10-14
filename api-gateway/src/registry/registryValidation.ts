export const ALLOWED_SERVICES = Object.freeze([
  'user-service',
  'product-service',
  'order-service'
] as const);

export type AllowedServiceName = (typeof ALLOWED_SERVICES)[number];

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

export interface SanitizedRegistrationData {
  serviceName: AllowedServiceName;
  port: number;
  host: string;
  url: string;
  id: string;
  weight: number;
}

/**
 * Validates the service name against the strictly allowed microservice whitelist.
 */
export function validateServiceName(name: unknown): ValidationResult<AllowedServiceName> {
  if (typeof name !== 'string' || !name.trim()) {
    return { valid: false, error: 'serviceName is required and must be a non-empty string.' };
  }
  const trimmed = name.trim();
  if (!ALLOWED_SERVICES.includes(trimmed as AllowedServiceName)) {
    return {
      valid: false,
      error: `Invalid serviceName '${trimmed}'. Allowed services are: ${ALLOWED_SERVICES.join(', ')}.`
    };
  }
  return { valid: true, value: trimmed as AllowedServiceName };
}

export const DEFAULT_DISALLOWED_PORTS = Object.freeze([
  22,    // SSH
  23,    // Telnet
  25,    // SMTP
  53,    // DNS
  6379,  // Redis
  8000,  // Gateway default (routing loop prevention)
  27017, // MongoDB default
  27018, // MongoDB shard
  27019, // MongoDB config
  2375,  // Docker daemon
  2376,  // Docker daemon TLS
  6443,  // Kubernetes API
  10250, // Kubelet API
  10255  // Kubelet read-only
]);

/**
 * Returns the effective set of disallowed infrastructure and sensitive service ports.
 */
export function getDisallowedPorts(): Set<number> {
  const disallowed = new Set<number>(DEFAULT_DISALLOWED_PORTS);

  const gwPort = Number(process.env.PORT_GATEWAY || process.env.PORT || 8000);
  if (Number.isInteger(gwPort) && gwPort > 0) {
    disallowed.add(gwPort);
  }

  if (process.env.DISALLOWED_REGISTRY_PORTS) {
    const custom = process.env.DISALLOWED_REGISTRY_PORTS.split(',').map(s => Number(s.trim()));
    for (const p of custom) {
      if (Number.isInteger(p) && p > 0) {
        disallowed.add(p);
      }
    }
  }

  return disallowed;
}

/**
 * Helper to parse comma-separated port numbers and ranges (e.g. "3001,3011-3099").
 */
export function parsePortListOrRanges(spec: string): ((port: number) => boolean)[] {
  const matchers: ((port: number) => boolean)[] = [];
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim());
      const start = Number(startStr);
      const end = Number(endStr);
      if (Number.isInteger(start) && Number.isInteger(end) && start <= end) {
        matchers.push((p: number) => p >= start && p <= end);
      }
    } else {
      const exact = Number(part);
      if (Number.isInteger(exact)) {
        matchers.push((p: number) => p === exact);
      }
    }
  }
  return matchers;
}

/**
 * Verifies whether a given port is within the authorized range for a microservice.
 */
export function isPortAllowedForService(serviceName: AllowedServiceName, port: number): boolean {
  if (process.env.ALLOWED_SERVICE_PORTS) {
    const globalMatchers = parsePortListOrRanges(process.env.ALLOWED_SERVICE_PORTS);
    if (globalMatchers.some(m => m(port))) return true;
  }

  let spec: string;
  switch (serviceName) {
    case 'user-service':
      spec = process.env.ALLOWED_USER_PORTS || '3001,3011-3099';
      break;
    case 'product-service':
      spec = process.env.ALLOWED_PRODUCT_PORTS || '3002,3012-3099,4000-4099';
      break;
    case 'order-service':
      spec = process.env.ALLOWED_ORDER_PORTS || '3003,3013-3099,5000-5099';
      break;
    default:
      return false;
  }

  const matchers = parsePortListOrRanges(spec);
  return matchers.some(m => m(port));
}

/**
 * Validates that the port is a valid TCP port number (1-65535), not a sensitive infrastructure port,
 * and falls within the service-specific allowed port range.
 */
export function validatePort(port: unknown, serviceName?: AllowedServiceName): ValidationResult<number> {
  if (port === undefined || port === null || port === '') {
    return { valid: false, error: 'port is required.' };
  }
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return { valid: false, error: 'port must be an integer between 1 and 65535.' };
  }

  const disallowed = getDisallowedPorts();
  if (disallowed.has(parsed)) {
    return {
      valid: false,
      error: `Port ${parsed} is a reserved or sensitive infrastructure port and cannot be registered.`
    };
  }

  if (serviceName && !isPortAllowedForService(serviceName, parsed)) {
    return {
      valid: false,
      error: `Port ${parsed} is not in the allowed port range for service '${serviceName}'.`
    };
  }

  return { valid: true, value: parsed };
}

export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'localhost',
  '127.0.0.1',
  '::1',
  'user-service',
  'product-service',
  'order-service'
]);

/**
 * Returns list of allowed registry destination hosts (default + ALLOWED_REGISTRY_HOSTS env).
 */
export function getAllowedHosts(): string[] {
  const hosts = new Set<string>(DEFAULT_ALLOWED_HOSTS);
  if (process.env.ALLOWED_REGISTRY_HOSTS) {
    const custom = process.env.ALLOWED_REGISTRY_HOSTS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const h of custom) hosts.add(h);
  }
  return Array.from(hosts);
}

/**
 * Validates the host destination against SSRF risks, cloud metadata endpoints,
 * path traversal, malicious special characters, and authorized destination hosts.
 */
export function validateHost(host: unknown): ValidationResult<string> {
  if (host === undefined || host === null || host === '') {
    return { valid: true, value: 'localhost' };
  }
  if (typeof host !== 'string') {
    return { valid: false, error: 'host must be a string.' };
  }

  const trimmed = host.trim().toLowerCase();
  if (trimmed.length > 253) {
    return { valid: false, error: 'host exceeds maximum length of 253 characters.' };
  }

  // Reject characters that could manipulate URLs or shell commands
  if (/[@:\/\\?#\s]/.test(trimmed) || trimmed.includes('..')) {
    return { valid: false, error: 'host contains invalid or malicious characters.' };
  }

  // SSRF Protection: Block cloud metadata endpoints and link-local ranges
  if (
    trimmed === '169.254.169.254' ||
    trimmed.startsWith('169.254.') ||
    trimmed === 'metadata.google.internal' ||
    trimmed === 'instance-data'
  ) {
    return { valid: false, error: 'host is a restricted cloud metadata or link-local address.' };
  }

  // Allow standard loopback, hostnames, and IP addresses
  const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
  if (!hostnameRegex.test(trimmed)) {
    return { valid: false, error: 'host is not a valid hostname or IP address format.' };
  }

  // If it looks like an IP address, validate octets 0-255
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    const octets = trimmed.split('.').map(Number);
    if (octets.some(o => o < 0 || o > 255)) {
      return { valid: false, error: 'host contains invalid IPv4 octet.' };
    }
  }

  // Validate against allowed destination host list
  const allowedHosts = getAllowedHosts();
  if (!allowedHosts.includes(trimmed)) {
    return {
      valid: false,
      error: `host '${trimmed}' is not an authorized registry destination host. Allowed hosts: ${allowedHosts.join(', ')}.`
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validates the destination URL for safe protocol, port, host, and absence of subpaths.
 */
export function validateUrl(url: unknown, expectedHost: string, expectedPort: number): ValidationResult<string> {
  if (url === undefined || url === null || url === '') {
    return { valid: true, value: `http://${expectedHost}:${expectedPort}` };
  }
  if (typeof url !== 'string') {
    return { valid: false, error: 'url must be a string.' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return { valid: false, error: 'url is not a valid URL.' };
  }

  // Protocol MUST be http: or https: (Strictly reject file:, ftp:, javascript:, etc.)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, error: `Disallowed protocol '${parsedUrl.protocol}'. Only http: and https: are permitted.` };
  }

  // Ensure no credentials embedded in URL
  if (parsedUrl.username || parsedUrl.password) {
    return { valid: false, error: 'url must not contain embedded user credentials.' };
  }

  // Ensure path is root only (prevent routing manipulation)
  if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
    return { valid: false, error: 'url must not contain custom paths.' };
  }

  // Ensure query strings and hash fragments are empty
  if (parsedUrl.search || parsedUrl.hash) {
    return { valid: false, error: 'url must not contain query parameters or hash fragments.' };
  }

  // Validate the URL's hostname
  const hostValidation = validateHost(parsedUrl.hostname);
  if (!hostValidation.valid) {
    return { valid: false, error: `url hostname error: ${hostValidation.error}` };
  }

  // Ensure URL port matches expected port if specified
  const urlPort = parsedUrl.port ? Number(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);
  if (urlPort !== expectedPort) {
    return { valid: false, error: `url port (${urlPort}) does not match registration port (${expectedPort}).` };
  }

  return { valid: true, value: `${parsedUrl.protocol}//${parsedUrl.hostname}:${urlPort}` };
}

/**
 * Validates the instance ID format to prevent injection and path traversal.
 */
export function validateInstanceId(id: unknown, defaultId: string): ValidationResult<string> {
  if (id === undefined || id === null || id === '') {
    return { valid: true, value: defaultId };
  }
  if (typeof id !== 'string') {
    return { valid: false, error: 'instanceId must be a string.' };
  }

  const trimmed = id.trim();
  if (trimmed.length > 128) {
    return { valid: false, error: 'instanceId must not exceed 128 characters.' };
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed) || trimmed.includes('..')) {
    return { valid: false, error: 'instanceId contains invalid characters. Only alphanumeric, dashes, dots, and underscores are allowed.' };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validates the instance load balancing weight.
 */
export function validateWeight(weight: unknown): ValidationResult<number> {
  if (weight === undefined || weight === null || weight === '') {
    return { valid: true, value: 1 };
  }
  const parsed = Number(weight);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return { valid: false, error: 'weight must be an integer between 1 and 100.' };
  }
  return { valid: true, value: parsed };
}

/**
 * Comprehensive validator for service registration requests.
 */
export function validateRegistrationPayload(body: any): ValidationResult<SanitizedRegistrationData> {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Registration payload must be a JSON object.' };
  }

  const serviceRes = validateServiceName(body.serviceName);
  if (!serviceRes.valid) return { valid: false, error: serviceRes.error || 'Invalid serviceName.' };

  const hostRes = validateHost(body.host);
  if (!hostRes.valid) return { valid: false, error: hostRes.error || 'Invalid host.' };

  const portRes = validatePort(body.port, serviceRes.value);
  if (!portRes.valid) return { valid: false, error: portRes.error || 'Invalid port.' };

  const urlRes = validateUrl(body.url, hostRes.value!, portRes.value!);
  if (!urlRes.valid) return { valid: false, error: urlRes.error || 'Invalid url.' };

  const defaultId = `${serviceRes.value}-${hostRes.value}-${portRes.value}`;
  const idRes = validateInstanceId(body.id || body.instanceId, defaultId);
  if (!idRes.valid) return { valid: false, error: idRes.error || 'Invalid instanceId.' };

  const weightRes = validateWeight(body.weight);
  if (!weightRes.valid) return { valid: false, error: weightRes.error || 'Invalid weight.' };

  return {
    valid: true,
    value: {
      serviceName: serviceRes.value!,
      port: portRes.value!,
      host: hostRes.value!,
      url: urlRes.value!,
      id: idRes.value!,
      weight: weightRes.value!,
    }
  };
}

