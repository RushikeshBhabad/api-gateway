const http = require('http');

async function sendRequest(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          instance: res.headers['x-upstream-instance'],
          strategy: res.headers['x-lb-strategy'],
          body: data
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        status: 0,
        error: err.message,
        instance: null
      });
    });

    req.end();
  });
}

async function verifyConsistentHashing() {
  console.log('\n======================================================');
  console.log('🧪 TEST 1: Consistent Hashing Semantic Verification');
  console.log('======================================================');

  const url = 'http://localhost:8000/api/products';
  const users = ['alice-101', 'bob-202', 'charlie-303', 'dave-404'];

  for (const user of users) {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const res = await sendRequest(url, { 'X-User-Id': user });
      results.push(res.instance);
    }

    const uniqueInstances = [...new Set(results)];
    const isConsistent = uniqueInstances.length === 1;
    console.log(`User: ${user.padEnd(12)} → Target: ${uniqueInstances[0]} ${isConsistent ? '✅ (100% Consistent)' : '❌ (Inconsistent!)'}`);
    if (!isConsistent) {
      console.error(`  FAIL: Requests routed to multiple instances: ${results.join(', ')}`);
      return false;
    }
  }

  console.log('✅ Consistent Hashing verified: Each user stickily hashes to their own node.');
  return true;
}

async function verifyLeastConnectionsConcurrent() {
  console.log('\n======================================================');
  console.log('🧪 TEST 2: Least Connections Concurrent Lifecycle Verification');
  console.log('======================================================');

  const url = 'http://localhost:8000/api/products';
  const concurrency = 20;
  console.log(`Sending ${concurrency} concurrent requests simultaneously...`);

  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(sendRequest(url));
  }

  const results = await Promise.all(promises);
  const instances = {};
  let failures = 0;

  for (const r of results) {
    if (r.status >= 200 && r.status < 400 && r.instance) {
      instances[r.instance] = (instances[r.instance] || 0) + 1;
    } else {
      failures++;
    }
  }

  console.log(`Total Requests: ${concurrency}, Succeeded: ${concurrency - failures}, Failed: ${failures}`);
  console.log('Distribution across instances:');
  for (const [inst, count] of Object.entries(instances)) {
    console.log(`  - ${inst}: ${count} requests`);
  }

  const distinctInstancesUsed = Object.keys(instances).length;
  console.log(`Total distinct instances utilized: ${distinctInstancesUsed}`);

  if (distinctInstancesUsed > 1 && failures === 0) {
    console.log('✅ Least Connections successfully distributed concurrent load across instances without errors.');
    return true;
  } else {
    console.log('❌ Least Connections verification failed.');
    return false;
  }
}

async function main() {
  const mode = process.argv[2] || 'ALL';
  if (mode === 'HASHING' || mode === 'ALL') {
    await verifyConsistentHashing();
  }
  if (mode === 'LEAST_CONN' || mode === 'ALL') {
    await verifyLeastConnectionsConcurrent();
  }
}

main().catch(console.error);
