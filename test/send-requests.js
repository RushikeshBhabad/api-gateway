const http = require('http');

async function sendRequest(url, key, strategy) {
  return new Promise((resolve) => {
    const start = Date.now();
    const options = new URL(url);
    const headers = {};
    
    // For consistent hashing, we simulate a userId header or query param
    if (key && strategy === 'CONSISTENT_HASHING') {
      // Gateway auth middleware usually extracts userId. We'll pass it as a custom header 
      // or assume the gateway path sets it up. If it uses IP, we can't easily mock it via standard http.get
      // Alternatively, assuming Gateway parses X-User-Id or we can append it as a query param if supported.
      headers['X-User-Id'] = key; 
    }

    const req = http.request(url, { headers }, (res) => {
      let instance = res.headers['x-upstream-instance'] || res.headers['x-service-instance'] || 'unknown';
      let strategyUsed = res.headers['x-lb-strategy'] || 'unknown';
      
      res.on('data', () => {}); // Consume body
      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          instance,
          strategy: strategyUsed,
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

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log("Usage: node send-requests.js <service> <num_requests> [STRATEGY] [key]");
    process.exit(1);
  }

  const serviceType = args[0].toLowerCase();
  const numRequests = parseInt(args[1], 10);
  const strategy = args[2] || 'ROUND_ROBIN';
  const key = args[3];

  const paths = {
    'user': '/api/users',
    'product': '/api/products',
    'order': '/api/orders'
  };

  const url = `http://localhost:8000${paths[serviceType]}`;
  
  console.log(`Sending ${numRequests} requests to ${url}...`);
  if (key) console.log(`Using Consistent Hashing Key: ${key}`);

  const results = {
    success: 0,
    failed: 0,
    instances: {}
  };

  for (let i = 1; i <= numRequests; i++) {
    const requestKey = (key === 'MULTI' || key === 'DISTRIBUTED') ? `user-${i}` : key;
    const res = await sendRequest(url, requestKey, strategy);
    
    if (res.success) {
      results.success++;
      results.instances[res.instance] = (results.instances[res.instance] || 0) + 1;
      let displayKey = requestKey ? `${requestKey} → ` : `Request ${i} → `;
      console.log(`${displayKey}${res.instance}   ✓ (Strategy: ${res.strategy})`);
    } else {
      results.failed++;
      console.log(`Request ${i} → ❌ Failed (${res.error || res.status})`);
    }
  }

  // Draw Visual Chart
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║          API GATEWAY LOAD BALANCER           ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  console.log(`Service      : ${serviceType}-service`);
  console.log(`Instances    : ${Object.keys(results.instances).length}`);
  console.log(`Strategy     : ${strategy}`);
  console.log(`Requests     : ${numRequests}`);
  if (key) console.log(`Hash Key     : ${key}`);
  console.log(`\nGateway :8000`);
  console.log(`    │`);

  const instanceKeys = Object.keys(results.instances).sort();
  for (let i = 0; i < instanceKeys.length; i++) {
    const inst = instanceKeys[i];
    const count = results.instances[inst];
    const isLast = (i === instanceKeys.length - 1);
    const prefix = isLast ? '    └──' : '    ├──';
    
    // Scale bar so max is 20 blocks
    const maxCount = Math.max(...Object.values(results.instances));
    const barBlocks = Math.round((count / maxCount) * 20) || 1;
    const bar = '█'.repeat(barBlocks);
    
    console.log(`${prefix} ${inst.padEnd(15)} ${bar} ${count}`);
  }

  console.log(`\nSuccess: ${results.success}`);
  console.log(`Failed : ${results.failed}\n`);
}

main();
