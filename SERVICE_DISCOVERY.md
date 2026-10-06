# Dynamic Self-Service Discovery & Heartbeat Monitoring

A complete guide to understanding **why** dynamic service discovery exists, **where** it is critical in production systems, and **how** the self-registration and heartbeat mechanisms are implemented under the hood in this API Gateway.

---

## 1. Why Do We Need This? (The Real-World Problem)

### The Old Way: Static Configuration
In traditional setups, the API Gateway knows about downstream microservices only through hardcoded IP addresses or ports in a `.env` file:

```env
PRODUCT_SERVICE_INSTANCES=http://localhost:4001,http://localhost:4002,http://localhost:4003
```

This static approach breaks down in modern distributed architectures:

1. **Autoscaling Nightmare:**
   Imagine Black Friday traffic hits your bookstore. An autoscaler dynamically launches 10 extra instances of `product-service` on ports `4004` to `4013`. The API Gateway has no idea these 10 new instances exist because they are not in `.env`. The gateway keeps hammering the original 3 instances until they crash under load.

2. **Zero-Downtime Rolling Updates:**
   When deploying a new version of `order-service`, modern infrastructure spins up new containers first, waits for them to become healthy, and then terminates the old ones. With static configuration, you would have to manually edit configuration files and restart the gateway for every deployment.

3. **Silent Traffic Blackholes:**
   If instance `4002` crashes or suffers an Out-Of-Memory (OOM) kill, a static gateway continues forwarding 33% of all customer requests to `4002`, causing immediate `502 Bad Gateway` or `ECONNREFUSED` errors for users.

---

### The New Way: Dynamic Self-Service Discovery
Instead of the gateway relying on static files, the microservices **manage their own presence**:

```text
┌─────────────────┐       1. POST /registry/register        ┌─────────────────────────┐
│                 │────────────────────────────────────────>│       API GATEWAY       │
│                 │                                         │   (Service Registry)    │
│ Product Service │       2. POST /registry/heartbeat       │                         │
│   (Port 4005)   │   (every 10s: "Still healthy!")         │  product-service:       │
│                 │────────────────────────────────────────>│   ├── :4001 (OK)        │
│                 │                                         │   ├── :4002 (OK)        │
│                 │       3. POST /registry/unregister      │   └── :4005 (NEW!)      │
│                 │      (on shutdown: "Signing off")       │                         │
│                 │────────────────────────────────────────>│                         │
└─────────────────┘                                         └─────────────────────────┘
```

1. **Self-Registration:** An instance boots up and introduces itself to the Gateway.
2. **Heartbeats:** The instance repeatedly informs the Gateway that it is alive.
3. **Health Tracking & Eviction:** If heartbeats stop arriving, the Gateway stops sending traffic to it.
4. **Graceful Deregistration:** When shutting down, the instance bids farewell so no requests are lost.

---

## 2. Where Is This Useful? (Industry Use Cases)

| Scenario | How Static Setup Fails | How Dynamic Discovery Solves It |
|---|---|---|
| **Cloud Autoscaling (AWS / GCP / K8s)** | Gateway only knows fixed addresses; newly spawned containers are invisible. | Containers self-register upon container boot; traffic distributes across all nodes immediately. |
| **Microservice Crash / Hang** | Gateway sends requests to dead process; users see 502/ECONNREFUSED errors. | Heartbeats time out after 30s; gateway automatically marks the instance unhealthy and stops routing to it. |
| **Blue/Green Deployments** | Requires restarting the gateway to update routing tables. | New version instances register as they boot; old instances unregister as they drain traffic. |
| **Local Multi-Instance Testing** | You must edit `.env` every time you want to test 5, 10, or 20 instances. | You can spin up any instance on any port (`PORT=9099 npm start`), and it immediately joins the load balancer pool. |

---

## 3. How the Heartbeat Mechanism Works (Under the Hood)

The heartbeat system is a **hybrid dual-layer health verification**:
1. **Passive Push (Heartbeat):** The microservice proactively pings the Gateway every 10 seconds.
2. **Active Pull (Gateway Health Check):** The Gateway periodically fetches `GET /health` on registered nodes.
3. **TTL Expiration (Zombie Eviction):** The Gateway checks timestamp freshness and evicts silent nodes.

### Step 1: The Microservice Sends Heartbeats
**File:** `product-service/src/registry/registerService.ts`

When the service boots, it starts a background timer using `setInterval`:

```typescript
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
    
    // Gateway restarted and wiped memory? Re-register immediately!
    if (res.status === 404) {
      console.log(`[Service Discovery] Gateway requested re-registration for ${instanceId}`);
      await register();
    }
  } catch {
    // Gateway temporarily unreachable; keep running and retry on next interval
  }
}, intervalMs); // 10,000 ms (10 seconds)
```

Every 10 seconds, this small HTTP payload is sent to `http://localhost:8000/registry/heartbeat`.

---

### Step 2: The Gateway Receives and Updates Timestamps
**File:** `api-gateway/src/loadbalance/ServiceRegistry.ts`

When `POST /registry/heartbeat` arrives at the Gateway:

```typescript
recordHeartbeat(serviceName: string, instanceId: string): boolean {
  const instances = this.services.get(serviceName);
  if (!instances) return false;

  const instance = instances.find(i => i.id === instanceId);
  if (instance) {
    // 1. Update the last known alive timestamp to NOW
    instance.lastHeartbeat = Date.now();
    
    // 2. If it was previously unhealthy, heal it!
    if (!instance.healthy) {
      instance.healthy = true;
      console.info(`[ServiceRegistry] Instance ${instanceId} recovered via heartbeat.`);
    }
    return true;
  }
  return false;
}
```

Every registered instance has a record in memory:
```json
{
  "id": "product-service-localhost-4001",
  "url": "http://localhost:4001",
  "healthy": true,
  "lastHeartbeat": 1759754400000,
  "registeredAt": 1759754300000
}
```

---

### Step 3: How the Gateway Actively Checks & Evicts Dead Instances
**File:** `api-gateway/src/loadbalance/ServiceRegistry.ts`

The Gateway runs a periodic background sweeper (`startHealthChecks`) every 15–30 seconds.

#### The Eviction Algorithm (`checkHeartbeats`):
```typescript
checkHeartbeats(timeoutMs: number = 30000): void {
  const now = Date.now();
  for (const [serviceName, instances] of this.services.entries()) {
    for (const instance of instances) {
      // If the instance has a heartbeat history AND has been silent for > 30 seconds
      if (instance.lastHeartbeat && (now - instance.lastHeartbeat > timeoutMs)) {
        if (instance.healthy) {
          instance.healthy = false;
          console.warn(`[ServiceRegistry] Instance ${instance.id} missed heartbeat (last: ${Math.round((now - instance.lastHeartbeat) / 1000)}s ago), marked UNHEALTHY.`);
        }
      }
    }
  }
}
```

#### What happens during routing:
When a customer makes a request to `GET /api/products`:
```typescript
getInstances(serviceName: string): ServiceInstance[] {
  // Only healthy instances are returned!
  let instances = (this.services.get(serviceName) || []).filter(i => i.healthy);

  // Circuit breaker also filters any instance with OPEN circuit
  if (circuitBreakerRegistry.isEnabled()) {
    instances = instances.filter(i => circuitBreakerRegistry.get(i.id).canRequest());
  }

  return instances;
}
```

Because `healthy` was set to `false`, the dead instance is **immediately excluded** from load balancer selection (`Round Robin`, `Least Connections`, `Random`, etc.). Customers never receive an error.

---

## 4. Edge Cases & Resilience Features

### 1. What if the API Gateway Restarts?
If the API Gateway crashes or restarts, its in-memory `Map` is wiped clean. 
- The next time microservices send their 10-second heartbeat, the Gateway returns `404 Not Found (Instance not found in registry)`.
- The microservice detects the `404` and immediately calls `register()` again.
- **Result:** Within 10 seconds of a Gateway restart, all microservices re-populate the registry automatically with zero human intervention.

### 2. Graceful Shutdown (Deregistration on Exit)
If an operator stops a service using `Ctrl + C` or Kubernetes sends `SIGTERM`:
```typescript
process.once('SIGTERM', async () => {
  await unregister(); // Sends POST /registry/unregister
  process.exit(0);
});
```
The Gateway removes the instance from the list **before** the process terminates. Not a single in-flight request is dropped.

### 3. Circuit Breaker Synergy
- **Heartbeats** detect if a process is **alive at the network layer**.
- **Circuit Breaker** detects if a process is **failing at the application layer** (e.g., throwing 500 database errors even while its process is alive).
- Both systems work together inside `getInstances()` to ensure only 100% operational instances serve users.

---

## 5. Summary Architecture Map

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY                               │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                    ServiceRegistry (Singleton)                 │   │
│   │                                                                │   │
│   │   services Map:                                                │   │
│   │     "product-service" => [                                     │   │
│   │       { id: "product-4001", healthy: true,  lastHeartbeat },   │   │
│   │       { id: "product-4002", healthy: false, lastHeartbeat },   │   │
│   │     ]                                                          │   │
│   └───────────────────────▲────────────────────────▲───────────────┘   │
│                           │                        │                   │
│         HTTP Registration │      Routing Request   │                   │
│                           │                        │                   │
│   ┌───────────────────────┴──────┐   ┌─────────────┴───────────────┐   │
│   │    registryRouter (REST)     │   │     createProxyMiddleware   │   │
│   │   - POST /registry/register  │   │     - router: (req) => {    │   │
│   │   - POST /registry/heartbeat │   │         getInstances(...)   │   │
│   │   - POST /registry/unregister│   │         selectInstance(...) │   │
│   └──────────────▲───────────────┘   │       }                     │   │
│                  │                   └───────────────▲─────────────┘   │
└──────────────────┼───────────────────────────────────┼─────────────────┘
                   │                                   │
      Heartbeat &  │                      User Traffic │
      Registration │                      HTTP Request │
                   │                                   │
┌──────────────────┴───────────────────────────────────┴─────────────────┐
│                        MICROSERVICE INSTANCE                           │
│                                                                        │
│   ┌──────────────────────────────┐   ┌─────────────────────────────┐   │
│   │     registerService.ts       │   │         server.ts           │   │
│   │   - registerWithGateway()    │   │   - express app             │   │
│   │   - 10s heartbeat timer      │   │   - GET /health             │   │
│   │   - SIGTERM unregister trap  │   │   - domain routes           │   │
│   └──────────────────────────────┘   └─────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

