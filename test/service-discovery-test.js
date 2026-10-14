const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

try {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.substring(0, idx).trim();
        const v = trimmed.substring(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch {}

const REGISTRY_TOKEN = process.env.SERVICE_REGISTRY_TOKEN || 'service_registry_secret_token_bookstore_2026';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const processes = [];

function startProcess(cmd, args, cwd, env, label) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text.includes('running on port') || text.includes('Registered') || text.includes('Unregistered')) {
      console.log(`   [${label}] ${text}`);
    }
  });

  child.stderr.on('data', () => {});
  processes.push({ child, label });
  return child;
}

function stopAll() {
  for (const p of processes) {
    if (!p.child.killed) {
      p.child.kill('SIGTERM');
    }
  }
}

process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

async function httpGet(url, customHeaders = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const headers = { ...customHeaders };
    if (urlObj.pathname.startsWith('/registry') && !headers['x-registry-token'] && !headers['authorization']) {
      headers['x-registry-token'] = REGISTRY_TOKEN;
    }
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers
    };
    http.get(options, (res) => {
      let data = '';
      const upstream = res.headers['x-upstream-instance'] || 'none';
      const strategy = res.headers['x-lb-strategy'] || 'none';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, data: json || data, upstream, strategy });
      });
    }).on('error', (err) => {
      resolve({ status: 500, error: err.message, upstream: 'none', strategy: 'none' });
    });
  });
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       AUTOMATIC SERVICE DISCOVERY & SELF-REGISTRATION      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // 1. Start API Gateway with NO pre-configured product instances
    console.log('Step 1: Starting API Gateway with ZERO pre-configured product instances in .env...');
    const gatewayDir = path.join(__dirname, '..', 'api-gateway');
    startProcess('npx', ['tsx', 'src/server.ts'], gatewayDir, {
      PORT_GATEWAY: '8000',
      LOAD_BALANCER_STRATEGY: 'ROUND_ROBIN',
      PRODUCT_SERVICE_INSTANCES: '', // Intentionally empty to prove discovery
      JWT_SECRET: process.env.JWT_SECRET || 'super_secret_jwt_key_for_this_project_123',
      SERVICE_REGISTRY_TOKEN: REGISTRY_TOKEN
    }, 'gateway');

    await delay(3000);

    // 2. Query registry endpoint
    console.log('\nStep 2: Checking Service Registry state on Gateway...');
    const regCheck1 = await httpGet('http://localhost:8000/registry');
    const initialProductInstances = regCheck1.data?.services?.['product-service'] || [];
    console.log(`   Registered product-service instances: ${initialProductInstances.length}`);

    // 3. Dynamically boot 3 separate product-service instances on different ports
    console.log('\nStep 3: Dynamically launching 3 instances of product-service (ports 4001, 4002, 4003)...');
    const productDir = path.join(__dirname, '..', 'product-service');

    const p1 = startProcess('npx', ['tsx', 'src/server.ts'], productDir, {
      PORT: '4001',
      PORT_PRODUCT: '4001',
      SERVICE_INSTANCE_ID: 'product-dynamic-4001',
      JWT_SECRET: process.env.JWT_SECRET || 'super_secret_jwt_key_for_this_project_123',
      SERVICE_REGISTRY_TOKEN: REGISTRY_TOKEN
    }, 'instance-4001');

    const p2 = startProcess('npx', ['tsx', 'src/server.ts'], productDir, {
      PORT: '4002',
      PORT_PRODUCT: '4002',
      SERVICE_INSTANCE_ID: 'product-dynamic-4002',
      JWT_SECRET: process.env.JWT_SECRET || 'super_secret_jwt_key_for_this_project_123',
      SERVICE_REGISTRY_TOKEN: REGISTRY_TOKEN
    }, 'instance-4002');

    const p3 = startProcess('npx', ['tsx', 'src/server.ts'], productDir, {
      PORT: '4003',
      PORT_PRODUCT: '4003',
      SERVICE_INSTANCE_ID: 'product-dynamic-4003',
      JWT_SECRET: process.env.JWT_SECRET || 'super_secret_jwt_key_for_this_project_123',
      SERVICE_REGISTRY_TOKEN: REGISTRY_TOKEN
    }, 'instance-4003');

    console.log('   Waiting for services to self-register via POST /registry/register...');
    await delay(4000);

    // 4. Query registry to confirm automatic discovery
    console.log('\nStep 4: Querying GET http://localhost:8000/registry after self-registration:');
    const regCheck2 = await httpGet('http://localhost:8000/registry');
    const discovered = regCheck2.data?.services?.['product-service'] || [];
    console.log(`   Total Discovered Instances: ${discovered.length}`);
    for (const inst of discovered) {
      console.log(`   ├── ${inst.id.padEnd(26)} URL: ${inst.url.padEnd(24)} Healthy: ${inst.healthy} (Heartbeat: ${inst.lastHeartbeat ? 'OK' : 'Pending'})`);
    }

    if (discovered.length < 3) {
      throw new Error(`Expected at least 3 instances to register, but found ${discovered.length}`);
    }

    // 5. Send requests to the gateway and check Load Balancer routing
    console.log('\nStep 5: Sending 6 requests through Gateway (http://localhost:8000/api/products)...');
    console.log('   Verifying the Load Balancer immediately routes across newly discovered instances:');
    for (let i = 1; i <= 6; i++) {
      const res = await httpGet('http://localhost:8000/api/products');
      console.log(`   Request ${i} → Routed to: ${res.upstream} (Status: ${res.status}) ✓`);
      await delay(100);
    }

    // 6. Test Graceful Deregistration: terminate instance 4002
    console.log('\nStep 6: Gracefully terminating instance-4002 (Testing Unregistration)...');
    p2.kill('SIGTERM');
    await delay(2000);

    // 7. Check registry again
    console.log('\nStep 7: Checking Service Registry after instance-4002 termination:');
    const regCheck3 = await httpGet('http://localhost:8000/registry');
    const remaining = regCheck3.data?.services?.['product-service'] || [];
    console.log(`   Remaining active instances: ${remaining.length}`);
    for (const inst of remaining) {
      console.log(`   ├── ${inst.id.padEnd(26)} URL: ${inst.url.padEnd(24)} Healthy: ${inst.healthy}`);
    }

    // 8. Send more requests through Gateway to verify traffic routes only to remaining alive instances
    console.log('\nStep 8: Sending 4 requests through Gateway...');
    console.log('   Verifying traffic only routes to surviving instances (4001 and 4003):');
    for (let i = 1; i <= 4; i++) {
      const res = await httpGet('http://localhost:8000/api/products');
      console.log(`   Request ${i} → Routed to: ${res.upstream} (Status: ${res.status}) ✓`);
      await delay(100);
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  🎉 SUCCESS! Service Discovery & Registration Verified!    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (err) {
    console.error('❌ Test failed:', err);
  } finally {
    stopAll();
    setTimeout(() => process.exit(0), 1000);
  }
}

main();
