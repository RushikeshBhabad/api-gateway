const assert = require('assert');
const { execSync } = require('child_process');

console.log('╔══════════════════════════════════════════════╗');
console.log('║       REDIS DISTRIBUTED LOCK UNIT TESTS      ║');
console.log('╚══════════════════════════════════════════════╝\n');

const tsxCmd = `npx tsx -e "
const Redis = require('ioredis');
const { RedisDistributedLock, RedisUnavailableError, LockAcquisitionTimeoutError } = require('./product-service/src/lock/RedisDistributedLock.ts');

async function runUnitTests() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });

  const lock = new RedisDistributedLock(redis);

  // Clean test keys
  await redis.del('lock:test:prod1', 'lock:test:prod2', 'lock:test:expired');

  try {
    // 1. A lock can be acquired
    console.log('[Test 1] Lock acquisition...');
    const handle1 = await lock.acquireLock('test:prod1', { ttlMs: 1000, timeoutMs: 200 });
    assert(handle1 && handle1.token, 'Should return handle with token');
    assert.strictEqual(handle1.resourceKey, 'test:prod1');
    console.log('   ✓ Lock acquired with token:', handle1.token);

    // 2. A second contender cannot acquire the same lock simultaneously
    console.log('[Test 2] Mutual exclusion for same resource...');
    let contenderFailed = false;
    try {
      await lock.acquireLock('test:prod1', { ttlMs: 1000, timeoutMs: 100 });
    } catch (err) {
      if (err instanceof LockAcquisitionTimeoutError) {
        contenderFailed = true;
      }
    }
    assert(contenderFailed, 'Contender should fail to acquire lock when already held');
    console.log('   ✓ Second contender timed out cleanly with LockAcquisitionTimeoutError');

    // 3. Different product keys can be locked independently
    console.log('[Test 3] Independent resource locking...');
    const handle2 = await lock.acquireLock('test:prod2', { ttlMs: 1000, timeoutMs: 200 });
    assert(handle2 && handle2.token, 'Should acquire lock for different product');
    console.log('   ✓ Different product locked concurrently without blocking');

    // 4. Only the owner token can release a lock
    console.log('[Test 4] Token-validated release (safety against unauthorized release)...');
    const fakeReleased = await lock.releaseLock('test:prod1', 'fake-invalid-token-12345');
    assert.strictEqual(fakeReleased, false, 'Invalid token must NOT release lock');
    const stillLocked = await redis.get('lock:test:prod1');
    assert.strictEqual(stillLocked, handle1.token, 'Lock key must remain intact in Redis');
    console.log('   ✓ Releasing with invalid token was rejected');

    // Clean release by actual owner
    const validReleased = await handle1.release();
    assert.strictEqual(validReleased, true, 'Actual owner should release cleanly');
    await handle2.release();
    console.log('   ✓ Actual owners successfully released locks');

    // 5. An expired lock can be acquired again
    console.log('[Test 5] Lease expiration allows re-acquisition...');
    const shortHandle = await lock.acquireLock('test:expired', { ttlMs: 150, timeoutMs: 200 });
    assert(shortHandle, 'Initial short lock acquired');
    // Wait for lease to expire
    await new Promise(r => setTimeout(r, 220));
    const reacquiredHandle = await lock.acquireLock('test:expired', { ttlMs: 500, timeoutMs: 200 });
    assert(reacquiredHandle, 'Should acquire lock after lease expired');
    await reacquiredHandle.release();
    console.log('   ✓ Expired lock acquired by next contender');

    // 6. An old owner cannot delete a newer owner\\'s lock (stale release bug protection)
    console.log('[Test 6] Stale owner cannot delete newer owner\\'s lock...');
    const staleHandle = await lock.acquireLock('test:stale', { ttlMs: 150, timeoutMs: 200 });
    const staleToken = staleHandle.token;
    // Wait for lease to expire
    await new Promise(r => setTimeout(r, 220));
    // New owner acquires
    const newHandle = await lock.acquireLock('test:stale', { ttlMs: 1000, timeoutMs: 200 });
    assert(newHandle.token !== staleToken, 'New owner should have different token');
    // Stale owner attempts release
    const staleReleased = await lock.releaseLock('test:stale', staleToken);
    assert.strictEqual(staleReleased, false, 'Stale owner release must return false');
    const newOwnerLock = await redis.get('lock:test:stale');
    assert.strictEqual(newOwnerLock, newHandle.token, 'New owner\\'s lock must still exist!');
    await newHandle.release();
    console.log('   ✓ Stale token release rejected, new owner\\'s lock preserved');

    // 7. Lock contention times out cleanly with bounded backoff
    console.log('[Test 7] Bounded wait and timeout during contention...');
    const holder = await lock.acquireLock('test:contention', { ttlMs: 1000, timeoutMs: 200 });
    const startWait = Date.now();
    let timedOut = false;
    try {
      await lock.acquireLock('test:contention', { ttlMs: 500, timeoutMs: 250, retryDelayMs: 40 });
    } catch (err) {
      if (err instanceof LockAcquisitionTimeoutError) {
        timedOut = true;
      }
    }
    const elapsed = Date.now() - startWait;
    assert(timedOut, 'Should timeout during contention');
    assert(elapsed >= 230 && elapsed <= 600, 'Timeout duration should be bounded around 250ms');
    await holder.release();
    console.log('   ✓ Contention timed out cleanly in ' + elapsed + 'ms');

    // 8. Redis connection failure is handled safely (503 Service Unavailable)
    console.log('[Test 8] Redis connection failure handling...');
    const deadRedis = new Redis('redis://127.0.0.1:59999', {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      retryStrategy: () => null,
      lazyConnect: true,
      enableOfflineQueue: false
    });
    deadRedis.on('error', () => {}); // Prevent unhandled EventEmitter error

    const deadLock = new RedisDistributedLock(deadRedis);
    let handledSafely = false;
    try {
      await deadLock.acquireLock('test:dead', { timeoutMs: 200 });
    } catch (err) {
      if (err instanceof RedisUnavailableError && err.statusCode === 503) {
        handledSafely = true;
      }
    }
    assert(handledSafely, 'Should throw RedisUnavailableError with HTTP 503 status');
    console.log('   ✓ Unreachable Redis threw RedisUnavailableError (HTTP 503)');

    deadRedis.disconnect();
    await redis.quit();
    console.log('\\n✅ All 8 Redis Distributed Lock Unit Tests Passed!');
    process.exit(0);
  } catch (err) {
    await redis.quit();
    console.error('❌ Unit test assertion failed:', err);
    process.exit(1);
  }
}

runUnitTests();
"`;

try {
  execSync(tsxCmd, { stdio: 'inherit' });
} catch (err) {
  process.exit(1);
}

