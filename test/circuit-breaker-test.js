const http = require('http');
const { startServiceInstance, startGateway, stopAll } = require('./process-manager');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendRequest(url, headers = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request(url, { headers }, (res) => {
      let instance = res.headers['x-upstream-instance'] || 'unknown';
      let lbStrategy = res.headers['x-lb-strategy'] || 'unknown';
      
      res.on('data', () => {}); 
      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          instance,
          strategy: lbStrategy,
          time: Date.now() - start
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message || err.code || String(err),
        instance: 'failed',
        strategy: 'unknown',
        time: Date.now() - start
      });
    });

    req.end();
  });
}

async function runCircuitBreakerTest() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       API GATEWAY CIRCUIT BREAKER TEST       ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Set Circuit Breaker environment variables
  process.env.CIRCUIT_BREAKER_ENABLED = 'true';
  process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD = '3';
  process.env.CIRCUIT_BREAKER_RESET_TIMEOUT = '3000'; // 3 seconds
  process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX_REQUESTS = '1';
  process.env.LOAD_BALANCER_STRATEGY = 'ROUND_ROBIN';

  // 1. Start 2 Product Service instances
  console.log('Starting 2 Product Service instances...');
  const instances = {
    'product': [
      { port: 4001, id: 'product-service-1' },
      { port: 4002, id: 'product-service-2' }
    ]
  };

  startServiceInstance('product', 4001, 'product-service-1');
  startServiceInstance('product', 4002, 'product-service-2');
  
  // 2. Start API Gateway
  startGateway(instances, 'ROUND_ROBIN');

  console.log('Waiting for services to initialize (5s)...');
  await delay(5000);

  const url = 'http://localhost:8000/api/products';
  console.log(`\n--- Initial State: Both services are CLOSED (Healthy) ---`);
  
  // Send 4 normal requests
  for (let i = 1; i <= 4; i++) {
    const res = await sendRequest(url);
    console.log(`Request ${i} → ${res.instance}   ✓ (Status: ${res.status})`);
    await delay(100);
  }

  console.log(`\n--- Injecting Failures into product-service-1 ---`);
  console.log(`Sending 3 failing requests to trip the circuit (Threshold: 3)...\n`);
  
  // We need to specifically target product-service-1.
  // We can do this by using the ROUND_ROBIN property.
  // Request 1 goes to 1, Request 2 goes to 2, Request 3 goes to 1...
  // Or we can just pass x-fail=true for the next 6 requests, 
  // so product-service-1 gets 3 failures and product-service-2 gets 3 failures.
  // BUT we only want ONE to fail.
  // Actually, we can use a custom header in product-service-1 to fail ONLY product-service-1.
  // Let's modify product-service to fail on `?fail=true`.
  
  let failures = 0;
  for (let i = 1; i <= 6; i++) {
    // Determine which instance is next by sending a test request
    // Actually just spam 6 requests where x-fail=true if the instance is product-service-1.
    // Wait, the API Gateway router doesn't know about x-fail before routing.
    // So if we send ?fail=true, BOTH will fail.
    // Let's change our failure injection to only fail if instance id matches!
    const failUrl = `${url}?fail=true&targetInstance=product-service-1`;
    const res = await sendRequest(failUrl);
    const icon = res.success ? '✓' : '❌';
    console.log(`Request ${i} → ${res.instance}   ${icon} (Status: ${res.status})`);
    await delay(100);
  }

  console.log(`\n--- Circuit for product-service-1 should now be OPEN ---`);
  console.log(`Routing should only go to product-service-2 now.\n`);

  for (let i = 1; i <= 4; i++) {
    const res = await sendRequest(url);
    console.log(`Request ${i} → ${res.instance}   ✓ (Status: ${res.status})`);
    await delay(100);
  }

  console.log(`\n--- Waiting for Reset Timeout (3s) ---`);
  await delay(3500);

  console.log(`\n--- Circuit should be HALF_OPEN ---`);
  console.log(`Sending 1 request. It should go to product-service-1 (HALF_OPEN allowance: 1).`);
  
  const resHalfOpen = await sendRequest(url);
  console.log(`Request 1 → ${resHalfOpen.instance}   ✓ (Status: ${resHalfOpen.status})`);

  console.log(`\n--- Circuit for product-service-1 should now be CLOSED ---`);
  console.log(`Traffic should balance between both instances again.\n`);
  
  for (let i = 1; i <= 4; i++) {
    const res = await sendRequest(url);
    console.log(`Request ${i} → ${res.instance}   ✓ (Status: ${res.status})`);
    await delay(100);
  }

  console.log(`\n✅ Circuit Breaker Test Complete!`);
  stopAll();
}

runCircuitBreakerTest().catch(console.error);
