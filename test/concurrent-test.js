const http = require('http');

async function sendRequest(url, key, strategy) {
  return new Promise((resolve) => {
    const start = Date.now();
    const headers = {};
    if (key) {
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
    console.log("Usage: node concurrent-test.js <service> <num_requests> [STRATEGY] [key]");
    process.exit(1);
  }

  const serviceType = args[0].toLowerCase();
  const numRequests = parseInt(args[1], 10);
  const strategy = args[2] || 'LEAST_CONNECTIONS';
  const key = args[3];

  const paths = {
    'user': '/api/users',
    'product': '/api/products',
    'order': '/api/orders'
  };

  const url = `http://localhost:8000${paths[serviceType]}`;
  
  console.log(`Sending ${numRequests} CONCURRENT requests to ${url}...`);

  const results = {
    success: 0,
    failed: 0,
    instances: {},
    totalLatency: 0
  };

  const promises = [];
  const globalStart = Date.now();

  for (let i = 1; i <= numRequests; i++) {
    const requestKey = (key === 'MULTI' || key === 'DISTRIBUTED') ? `user-${i}` : key;
    promises.push(sendRequest(url, requestKey, strategy).then(res => {
      if (res.success) {
        results.success++;
        results.instances[res.instance] = (results.instances[res.instance] || 0) + 1;
        results.totalLatency += res.time;
      } else {
        results.failed++;
      }
    }));
  }

  await Promise.all(promises);
  const globalEnd = Date.now();

  // Draw Visual Chart
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║      CONCURRENT LOAD BALANCER RESULTS        ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  console.log(`Total Requests : ${numRequests}`);
  console.log(`Successful     : ${results.success}`);
  console.log(`Failed         : ${results.failed}`);
  
  if (results.success > 0) {
    console.log(`Avg Latency    : ${(results.totalLatency / results.success).toFixed(2)} ms`);
  }
  console.log(`Total Duration : ${globalEnd - globalStart} ms`);

  console.log(`\nInstance Distribution:`);
  console.log(`Gateway :8000`);
  console.log(`    │`);

  const instanceKeys = Object.keys(results.instances).sort();
  for (let i = 0; i < instanceKeys.length; i++) {
    const inst = instanceKeys[i];
    const count = results.instances[inst];
    const isLast = (i === instanceKeys.length - 1);
    const prefix = isLast ? '    └──' : '    ├──';
    
    // Scale bar
    const maxCount = Math.max(...Object.values(results.instances));
    const barBlocks = Math.round((count / maxCount) * 20) || 1;
    const bar = '█'.repeat(barBlocks);
    
    console.log(`${prefix} ${inst.padEnd(15)} ${bar} ${count}`);
  }
  console.log();
}

main();
