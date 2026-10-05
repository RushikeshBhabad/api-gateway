export interface ServiceRegistrationOptions {
  serviceName: string;
  port: number | string;
  host?: string;
  instanceId?: string;
  gatewayUrl?: string;
  heartbeatIntervalMs?: number;
}

/**
 * Automatically registers this service instance with the API Gateway Service Registry,
 * maintains periodic heartbeats, and unregisters on process termination.
 */
export function registerWithGateway(options: ServiceRegistrationOptions): { unregister: () => Promise<void> } {
  const gatewayUrl = options.gatewayUrl || process.env.GATEWAY_URL || 'http://localhost:8000';
  const port = Number(options.port);
  const host = options.host || 'localhost';
  const instanceId = options.instanceId || `${options.serviceName}-${host}-${port}`;
  const intervalMs = options.heartbeatIntervalMs || 10000;

  async function register() {
    try {
      const res = await fetch(`${gatewayUrl}/registry/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: options.serviceName,
          host,
          port,
          id: instanceId,
          url: `http://${host}:${port}`
        })
      });
      if (res.ok) {
        console.log(`[Service Discovery] Registered ${instanceId} with Gateway at ${gatewayUrl}`);
      }
    } catch (err: any) {
      console.warn(`[Service Discovery] Could not reach Gateway at ${gatewayUrl} (${err.message}). Retrying on heartbeat...`);
    }
  }

  // 1. Initial register
  register();

  // 2. Periodic heartbeat
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`${gatewayUrl}/registry/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: options.serviceName,
          instanceId
        })
      });
      if (res.status === 404) {
        // Gateway restarted and lost state; re-register!
        console.log(`[Service Discovery] Gateway requested re-registration for ${instanceId}`);
        await register();
      }
    } catch {
      // Gateway temporarily unreachable; keep running
    }
  }, intervalMs);

  // 3. Graceful shutdown handler
  async function unregister() {
    clearInterval(timer);
    try {
      await fetch(`${gatewayUrl}/registry/unregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: options.serviceName,
          instanceId
        })
      });
      console.log(`[Service Discovery] Unregistered ${instanceId} from Gateway`);
    } catch {}
  }

  process.once('SIGINT', async () => {
    await unregister();
    process.exit(0);
  });
  process.once('SIGTERM', async () => {
    await unregister();
    process.exit(0);
  });

  return { unregister };
}

