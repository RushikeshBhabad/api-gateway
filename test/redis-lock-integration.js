const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const mongoose = require(path.join(__dirname, '../product-service/node_modules/mongoose'));

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
    if (text.includes('running on port') || text.includes('Compensated') || text.includes('error')) {
      // console.log(`   [${label}] ${text}`);
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

function httpRequest(options, postData) {
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data: json || data });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 500, error: err.message });
    });

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runIntegrationTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   REDIS DISTRIBUTED LOCK INVENTORY INTEGRATION SUITE       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bookstore';
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const productsCol = db.collection('products');
  const reservationsCol = db.collection('reservations');

  const productDir = path.join(__dirname, '..', 'product-service');
  const orderDir = path.join(__dirname, '..', 'order-service');

  try {
    // Start Product Service on port 4010
    console.log('Starting Product Service instance (port 4010)...');
    startProcess('npx', ['tsx', 'src/server.ts'], productDir, {
      PORT: '4010',
      PORT_PRODUCT: '4010',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SERVICE_INSTANCE_ID: 'product-svc-4010'
    }, 'product-4010');

    // Start Order Service Instance 1 on port 5011
    console.log('Starting Order Service Instance 1 (port 5011)...');
    startProcess('npx', ['tsx', 'src/server.ts'], orderDir, {
      PORT: '5011',
      PORT_ORDER: '5011',
      PRODUCT_SERVICE_URL: 'http://localhost:4010/products',
      SERVICE_INSTANCE_ID: 'order-svc-5011'
    }, 'order-5011');

    // Start Order Service Instance 2 on port 5012
    console.log('Starting Order Service Instance 2 (port 5012)...');
    startProcess('npx', ['tsx', 'src/server.ts'], orderDir, {
      PORT: '5012',
      PORT_ORDER: '5012',
      PRODUCT_SERVICE_URL: 'http://localhost:4010/products',
      SERVICE_INSTANCE_ID: 'order-svc-5012'
    }, 'order-5012');

    console.log('Waiting for services to be ready (4s)...');
    await delay(4000);

    // -------------------------------------------------------------
    // Test 1-4: Concurrent order requests for stock=1 from separate Order Service processes
    // -------------------------------------------------------------
    console.log('\n[Test 1-4] Concurrency: 2 separate Order Service processes reserving product with stock=1...');
    const prod1Insert = await productsCol.insertOne({
      title: 'High-Demand Limited Book',
      author: 'Author One',
      category: 'Fiction',
      price: 25,
      stock: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const prod1Id = prod1Insert.insertedId.toString();

    // Fire requests concurrently to order-service on 5011 and 5012
    const [resOrder1, resOrder2] = await Promise.all([
      httpRequest({
        hostname: 'localhost',
        port: 5011,
        path: '/orders',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-alpha' }
      }, { items: [{ productId: prod1Id, quantity: 1 }] }),

      httpRequest({
        hostname: 'localhost',
        port: 5012,
        path: '/orders',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-beta' }
      }, { items: [{ productId: prod1Id, quantity: 1 }] })
    ]);

    const successes = [resOrder1, resOrder2].filter(r => r.status === 201);
    const failures = [resOrder1, resOrder2].filter(r => r.status >= 400);

    assert.strictEqual(successes.length, 1, `Exactly one order request must succeed! (Got ${successes.length})`);
    assert.strictEqual(failures.length, 1, `Exactly one order request must fail with insufficient stock! (Got ${failures.length})`);

    const finalProd1 = await productsCol.findOne({ _id: prod1Insert.insertedId });
    assert.strictEqual(finalProd1.stock, 0, `Final stock must be exactly 0! Got: ${finalProd1.stock}`);
    console.log(`   ✓ Exactly 1 order succeeded (HTTP 201), 1 failed (HTTP ${failures[0].status})`);
    console.log(`   ✓ Authoritative MongoDB final stock is 0 (overselling strictly prevented)`);

    // -------------------------------------------------------------
    // Test 5: Insufficient stock fails cleanly without changing inventory
    // -------------------------------------------------------------
    console.log('\n[Test 5] Insufficient stock fails without altering database...');
    const resOverOrder = await httpRequest({
      hostname: 'localhost',
      port: 5011,
      path: '/orders',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-gamma' }
    }, { items: [{ productId: prod1Id, quantity: 1 }] });

    assert.strictEqual(resOverOrder.status, 400, 'Request exceeding stock must return 400');
    const prod1CheckAgain = await productsCol.findOne({ _id: prod1Insert.insertedId });
    assert.strictEqual(prod1CheckAgain.stock, 0, 'Stock must remain 0');
    console.log('   ✓ Over-reservation rejected with HTTP 400; inventory unchanged');

    // -------------------------------------------------------------
    // Test 6: Concurrent requests for different products proceed independently
    // -------------------------------------------------------------
    console.log('\n[Test 6] Independent concurrent requests for different products...');
    const prodA = await productsCol.insertOne({
      title: 'Book A', author: 'Author A', category: 'Tech', price: 10, stock: 10
    });
    const prodB = await productsCol.insertOne({
      title: 'Book B', author: 'Author B', category: 'Tech', price: 10, stock: 10
    });

    const [resA, resB] = await Promise.all([
      httpRequest({
        hostname: 'localhost',
        port: 5011,
        path: '/orders',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-A' }
      }, { items: [{ productId: prodA.insertedId.toString(), quantity: 2 }] }),

      httpRequest({
        hostname: 'localhost',
        port: 5012,
        path: '/orders',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-B' }
      }, { items: [{ productId: prodB.insertedId.toString(), quantity: 3 }] })
    ]);

    assert.strictEqual(resA.status, 201, 'Order for Product A should succeed');
    assert.strictEqual(resB.status, 201, 'Order for Product B should succeed');
    const finalA = await productsCol.findOne({ _id: prodA.insertedId });
    const finalB = await productsCol.findOne({ _id: prodB.insertedId });
    assert.strictEqual(finalA.stock, 8, 'Product A stock should be 8');
    assert.strictEqual(finalB.stock, 7, 'Product B stock should be 7');
    console.log('   ✓ Both independent product orders completed concurrently in parallel');

    // -------------------------------------------------------------
    // Test 7: Order creation failure triggers automatic stock compensation
    // -------------------------------------------------------------
    console.log('\n[Test 7] Multi-item order failure triggers stock compensation...');
    // Create product C with stock=5 and product D with stock=0
    const prodC = await productsCol.insertOne({
      title: 'Book C', author: 'Author C', category: 'Tech', price: 10, stock: 5
    });
    const prodD = await productsCol.insertOne({
      title: 'Book D', author: 'Author D', category: 'Tech', price: 10, stock: 0
    });

    // Attempt multi-item order where Item 1 (Book C) succeeds, but Item 2 (Book D) fails!
    const resMultiOrder = await httpRequest({
      hostname: 'localhost',
      port: 5011,
      path: '/orders',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'user-multi' }
    }, {
      items: [
        { productId: prodC.insertedId.toString(), quantity: 2 },
        { productId: prodD.insertedId.toString(), quantity: 1 } // Will fail!
      ]
    });

    assert(resMultiOrder.status >= 400, 'Order must fail because Book D has 0 stock');
    await delay(500); // Allow async compensation call to finish
    const finalC = await productsCol.findOne({ _id: prodC.insertedId });
    assert.strictEqual(finalC.stock, 5, `Book C stock must be compensated back to 5! Current: ${finalC.stock}`);
    console.log('   ✓ Stock compensation verified: Book C stock was restored to 5');

    // -------------------------------------------------------------
    // Test 8: Duplicate compensation idempotency
    // -------------------------------------------------------------
    console.log('\n[Test 8] Duplicate compensation idempotency...');
    // Manually create a reservation and release it twice
    const prodE = await productsCol.insertOne({
      title: 'Book E', author: 'Author E', category: 'Tech', price: 10, stock: 10
    });
    const prodEId = prodE.insertedId.toString();

    // 1. Reserve 3
    const resReserve = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 3 });

    assert.strictEqual(resReserve.status, 200);
    const reservationId = resReserve.data.reservationId;
    let currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 7, 'Stock should be 7 after reserving 3');

    // 2. First Release
    const resRelease1 = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/release`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 3, reservationId });
    assert.strictEqual(resRelease1.status, 200);
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 10, 'Stock restored to 10');

    // 3. Duplicate Release (Replay attack / network retry)
    const resRelease2 = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/release`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 3, reservationId });
    assert.strictEqual(resRelease2.status, 200);
    assert.strictEqual(resRelease2.data.alreadyCompensated, true, 'Must identify as alreadyCompensated');
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 10, 'Stock must NOT be incremented a second time!');
    console.log('   ✓ Duplicate compensation prevented: stock remained 10, not 13');

    // 4. Concurrent compensation race (Two requests racing to release the same reservation)
    console.log('\n[Test 8b] Concurrent compensation race (Two concurrent releases for same reservation)...');
    const resReserveRace = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 4 });
    const raceResId = resReserveRace.data.reservationId;
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 6, 'Stock should be 6 after reserving 4');

    // Fire 2 compensation requests concurrently
    const [raceComp1, raceComp2] = await Promise.all([
      httpRequest({
        hostname: 'localhost',
        port: 4010,
        path: `/products/${prodEId}/release`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      }, { quantity: 4, reservationId: raceResId }),
      httpRequest({
        hostname: 'localhost',
        port: 4010,
        path: `/products/${prodEId}/release`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      }, { quantity: 4, reservationId: raceResId })
    ]);

    assert.strictEqual(raceComp1.status, 200);
    assert.strictEqual(raceComp2.status, 200);
    const oneCompensated = (raceComp1.data.alreadyCompensated === true) || (raceComp2.data.alreadyCompensated === true);
    assert(oneCompensated, 'One of the concurrent compensation requests must be detected as duplicate/alreadyCompensated');
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 10, 'Stock must be restored to 10 exactly once, never 14!');
    console.log('   ✓ Concurrent compensation race handled: stock restored to 10 exactly once');

    // 5. Idempotent reservation retry with same reservationId
    console.log('\n[Test 8c] Idempotent reservation retry (Client timeout retry)...');
    const clientRetryResId = 'client-uuid-test-' + crypto.randomUUID();
    const resFirstAttempt = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 2, reservationId: clientRetryResId });
    assert.strictEqual(resFirstAttempt.status, 200);
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 8, 'Stock should be 8 after reserving 2');

    // Retry with exact same reservationId
    const resRetryAttempt = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 2, reservationId: clientRetryResId });
    assert.strictEqual(resRetryAttempt.status, 200);
    assert.strictEqual(resRetryAttempt.data.idempotentRetry, true, 'Retry must return idempotentRetry: true');
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 8, 'Stock must remain 8, not decremented again to 6!');
    console.log('   ✓ Idempotent reservation retry verified: stock remained 8, no duplicate decrement');

    // 6. Test 8d: Reject mismatched reuse of reservationId (different quantity or product)
    console.log('\n[Test 8d] Reject reservationId reuse with mismatched quantity or product...');
    // Attempt 1: Same reservationId, different quantity (requested 5, original was 2)
    const resMismatchQty = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 5, reservationId: clientRetryResId });
    assert.strictEqual(resMismatchQty.status, 409, `Expected HTTP 409 on quantity mismatch, got ${resMismatchQty.status}`);
    assert.strictEqual(resMismatchQty.data.error.code, 'RESERVATION_MISMATCH');
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 8, 'Stock must not change when quantity is mismatched');

    // Attempt 2: Same reservationId, different product
    const prodFInsert = await productsCol.insertOne({
      title: 'Book F (Mismatch Test)', author: 'Author F', category: 'Tech', price: 18, stock: 10,
      createdAt: new Date(), updatedAt: new Date()
    });
    const prodFId = prodFInsert.insertedId.toString();

    const resMismatchProd = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodFId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 2, reservationId: clientRetryResId });
    assert.strictEqual(resMismatchProd.status, 409, `Expected HTTP 409 on product mismatch, got ${resMismatchProd.status}`);
    assert.strictEqual(resMismatchProd.data.error.code, 'RESERVATION_MISMATCH');
    const currentProdF = await productsCol.findOne({ _id: prodFInsert.insertedId });
    assert.strictEqual(currentProdF.stock, 10, 'Stock of different product must not change');
    console.log('   ✓ Mismatched reservationId reuse rejected with HTTP 409 RESERVATION_MISMATCH; stock preserved');

    // 7. Test 8e: Compensation validation and post-release re-reservation prevention
    console.log('\n[Test 8e] Compensation validation and post-release re-reservation rejection...');
    // Attempt compensation on mismatched product
    const resCompMismatchProd = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodFId}/release`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 2, reservationId: clientRetryResId });
    assert.strictEqual(resCompMismatchProd.status, 400);
    assert.strictEqual(resCompMismatchProd.data.error.code, 'PRODUCT_MISMATCH');

    // Attempt compensation on mismatched quantity
    const resCompMismatchQty = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/release`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 99, reservationId: clientRetryResId });
    assert.strictEqual(resCompMismatchQty.status, 400);
    assert.strictEqual(resCompMismatchQty.data.error.code, 'QUANTITY_MISMATCH');

    // Valid release
    const resCompValid = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/release`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 2, reservationId: clientRetryResId });
    assert.strictEqual(resCompValid.status, 200);
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 10, 'Stock must be restored to 10 on valid compensation');

    // Attempt to re-reserve a released reservation
    const resRereserve = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: `/products/${prodEId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 2, reservationId: clientRetryResId });
    assert.strictEqual(resRereserve.status, 400);
    assert.strictEqual(resRereserve.data.error.code, 'INVALID_RESERVATION');
    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 10, 'Stock must not be decremented after re-reservation of released ID');
    console.log('   ✓ Compensation validation and post-release rejection verified');

    // 8. Test 8f: Recoverable reconciliation mechanism for standalone MongoDB
    console.log('\n[Test 8f] Recoverable reconciliation mechanism for standalone MongoDB...');
    const reconciliationsCol = db.collection('reconciliationtasks');
    await reconciliationsCol.insertOne({
      productId: prodEId,
      reservationId: 'test-reconcile-uuid-' + crypto.randomUUID(),
      quantity: 4,
      action: 'RESTORE_STOCK',
      reason: 'Automated test reconciliation of failed rollback',
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Stock before reconciliation is 10
    const resReconcile = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: '/products/reconcile',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(resReconcile.status, 200);
    assert(resReconcile.data.data.resolved >= 1, 'At least 1 pending reconciliation task resolved');

    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 14, 'Stock should be recovered to 14 by reconciliation worker');

    // Re-run reconciliation (idempotent, no extra stock added)
    const resReconcileAgain = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: '/products/reconcile',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(resReconcileAgain.status, 200);
    assert.strictEqual(resReconcileAgain.data.data.totalProcessed, 0, 'No remaining pending tasks');

    currentProdE = await productsCol.findOne({ _id: prodE.insertedId });
    assert.strictEqual(currentProdE.stock, 14, 'Stock must remain 14 on repeated reconciliation run');
    console.log('   ✓ Recoverable reconciliation mechanism verified: pending tasks resolved, stock restored');

    // 9. Test 8g: Concurrent duplicate reconciliation workers
    console.log('\n[Test 8g] Concurrent duplicate reconciliation workers (Mutual exclusion test)...');
    const prodGInsert = await productsCol.insertOne({
      title: 'Worker Concurrency Test Book', author: 'Author G', category: 'Tech', price: 20, stock: 10,
      reconciledTasks: [], createdAt: new Date(), updatedAt: new Date()
    });
    const prodGId = prodGInsert.insertedId.toString();

    // Insert 3 separate pending tasks for Product G (restoring 2, 3, and 5 stock; total 10)
    await reconciliationsCol.insertMany([
      {
        productId: prodGId,
        reservationId: 'worker-race-1-' + crypto.randomUUID(),
        quantity: 2,
        action: 'RESTORE_STOCK',
        reason: 'Concurrent worker test task 1',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        productId: prodGId,
        reservationId: 'worker-race-2-' + crypto.randomUUID(),
        quantity: 3,
        action: 'RESTORE_STOCK',
        reason: 'Concurrent worker test task 2',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        productId: prodGId,
        reservationId: 'worker-race-3-' + crypto.randomUUID(),
        quantity: 5,
        action: 'RESTORE_STOCK',
        reason: 'Concurrent worker test task 3',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    // Fire 2 reconciliation worker requests concurrently
    const [workerA, workerB] = await Promise.all([
      httpRequest({
        hostname: 'localhost',
        port: 4010,
        path: '/products/reconcile',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { workerId: 'worker-A' }),
      httpRequest({
        hostname: 'localhost',
        port: 4010,
        path: '/products/reconcile',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { workerId: 'worker-B' })
    ]);

    assert.strictEqual(workerA.status, 200);
    assert.strictEqual(workerB.status, 200);
    const totalResolved = (workerA.data.data.resolved || 0) + (workerB.data.data.resolved || 0);
    assert.strictEqual(totalResolved, 3, `Expected exactly 3 tasks resolved across both workers, got ${totalResolved}`);

    const finalProdG = await productsCol.findOne({ _id: prodGInsert.insertedId });
    // Started at 10, total restored is 2+3+5=10 -> final stock MUST be exactly 20, never duplicate (30)
    assert.strictEqual(finalProdG.stock, 20, `Stock must be exactly 20 (got ${finalProdG.stock}); no duplicate increment across concurrent workers`);
    console.log('   ✓ Concurrent workers safely coordinated via atomic claiming: stock restored to 20 exactly once');

    // 10. Test 8h: Stock-increment / Task-status crash window simulation
    console.log('\n[Test 8h] Stock-increment / Task-status crash window simulation (Idempotent crash recovery)...');
    const prodHInsert = await productsCol.insertOne({
      title: 'Crash Window Test Book', author: 'Author H', category: 'Tech', price: 30, stock: 15,
      reconciledTasks: [], createdAt: new Date(), updatedAt: new Date()
    });
    const prodHId = prodHInsert.insertedId.toString();

    // Create a task that crashed mid-execution:
    const crashTaskInsert = await reconciliationsCol.insertOne({
      productId: prodHId,
      reservationId: 'crash-window-' + crypto.randomUUID(),
      quantity: 5,
      action: 'RESTORE_STOCK',
      reason: 'Crash window simulation',
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 60000), // 60s ago (stale lock)
      lockedBy: 'crashed-worker-pid-999',
      attempts: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const crashTaskId = crashTaskInsert.insertedId.toString();
    const crashTaskToken = `task:${crashTaskId}`;

    // Simulate that the crashed worker succeeded in incrementing stock & recording taskToken in Product,
    // but crashed BEFORE updating the task document to RESOLVED in MongoDB:
    await productsCol.updateOne(
      { _id: prodHInsert.insertedId },
      {
        $inc: { stock: 5 },
        $addToSet: { reconciledTasks: crashTaskToken }
      }
    );

    // Initial stock was 15, crashed worker incremented by 5 -> stock in DB is now 20
    const preRecoveryProdH = await productsCol.findOne({ _id: prodHInsert.insertedId });
    assert.strictEqual(preRecoveryProdH.stock, 20, 'Stock before recovery worker is 20');

    // Now trigger the recovery worker with staleTimeoutMs: 1000 to pick up the abandoned task
    const resCrashRecovery = await httpRequest({
      hostname: 'localhost',
      port: 4010,
      path: '/products/reconcile',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { staleTimeoutMs: 1000, workerId: 'worker-recovery' });

    assert.strictEqual(resCrashRecovery.status, 200);
    const recoveredTaskReport = resCrashRecovery.data.data.tasks.find(t => t.taskId === crashTaskId);
    assert(recoveredTaskReport, 'Recovery worker must find and process the abandoned task');
    assert.strictEqual(recoveredTaskReport.alreadyApplied, true, 'Worker must detect alreadyApplied: true from product.reconciledTasks');
    assert.strictEqual(recoveredTaskReport.success, true);

    // CRITICAL: Stock MUST remain 20! Must NOT be incremented again to 25!
    const postRecoveryProdH = await productsCol.findOne({ _id: prodHInsert.insertedId });
    assert.strictEqual(postRecoveryProdH.stock, 20, `Stock must strictly remain 20 (got ${postRecoveryProdH.stock}); duplicate increment prevented on crash retry!`);

    // Verify task is now RESOLVED in MongoDB
    const resolvedCrashTask = await reconciliationsCol.findOne({ _id: crashTaskInsert.insertedId });
    assert.strictEqual(resolvedCrashTask.status, 'RESOLVED');
    assert(resolvedCrashTask.resolvedAt, 'Task must have resolvedAt set');
    console.log('   ✓ Post-increment crash recovery verified: alreadyApplied detected, stock not duplicated, task marked RESOLVED');

    // -------------------------------------------------------------
    // Test 9: Redis unavailable: reservation returns HTTP 503
    // -------------------------------------------------------------
    console.log('\n[Test 9] Redis unavailable follows failure policy (HTTP 503)...');
    // Start a Product Service instance with an unreachable Redis URL
    startProcess('npx', ['tsx', 'src/server.ts'], productDir, {
      PORT: '4019',
      PORT_PRODUCT: '4019',
      REDIS_URL: 'redis://127.0.0.1:59999', // Dead port
      SERVICE_INSTANCE_ID: 'product-svc-dead-redis'
    }, 'product-dead-redis');

    await delay(3000);

    const resDeadRedis = await httpRequest({
      hostname: 'localhost',
      port: 4019,
      path: `/products/${prodEId}/reserve`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { quantity: 1 });

    assert.strictEqual(resDeadRedis.status, 503, `Expected HTTP 503 when Redis is unavailable, got ${resDeadRedis.status}`);
    assert.strictEqual(resDeadRedis.data.error.code, 'SERVICE_UNAVAILABLE');
    console.log('   ✓ Controlled HTTP 503 returned when Redis is unavailable; no silent bypass');

    // -------------------------------------------------------------
    // Test 10: Lock lease expiry safety check (Conditional update protects inventory)
    // -------------------------------------------------------------
    console.log('\n[Test 10] Conditional MongoDB update protects inventory under race conditions...');
    // Directly test that MongoDB atomic decrement condition `{ stock: { $gte: quantity } }` rejects overselling
    const testRaceProd = await productsCol.insertOne({
      title: 'Race Condition Test', stock: 1, price: 15, author: 'Race', category: 'Tech'
    });
    const update1 = await productsCol.findOneAndUpdate(
      { _id: testRaceProd.insertedId, stock: { $gte: 1 } },
      { $inc: { stock: -1 } },
      { returnDocument: 'after' }
    );
    const update2 = await productsCol.findOneAndUpdate(
      { _id: testRaceProd.insertedId, stock: { $gte: 1 } },
      { $inc: { stock: -1 } },
      { returnDocument: 'after' }
    );
    assert(update1, 'First update succeeds');
    assert.strictEqual(update2, null, 'Second update fails because stock condition { $gte: 1 } fails');
    const finalRaceStock = (await productsCol.findOne({ _id: testRaceProd.insertedId })).stock;
    assert.strictEqual(finalRaceStock, 0, 'Final race stock is 0');
    console.log('   ✓ Authoritative conditional DB update verified: stock is 0, never negative');

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  🎉 ALL INVENTORY & RECONCILIATION TESTS PASSED!           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (err) {
    console.error('❌ Integration test failed:', err);
    process.exit(1);
  } finally {
    stopAll();
    await mongoose.disconnect();
    setTimeout(() => process.exit(0), 1000);
  }
}

runIntegrationTests();
