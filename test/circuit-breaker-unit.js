const { execSync } = require('child_process');
const assert = require('assert');

// A quick and dirty unit test script using Node.js assert
// We run this via tsx to load the TS module directly
const tsxCmd = `npx tsx -e "
const { CircuitBreaker, CircuitBreakerState } = require('./api-gateway/src/circuitbreaker/CircuitBreaker.ts');

const config = {
  failureThreshold: 3,
  resetTimeout: 100, // 100ms
  halfOpenMaxRequests: 1
};

const cb = new CircuitBreaker(config);

// 1. Initial state is CLOSED
if (cb.getState() !== CircuitBreakerState.CLOSED) throw new Error('Should start CLOSED');
if (!cb.canRequest()) throw new Error('Should allow requests initially');

// 2. Trip to OPEN on failures
cb.onFailure();
cb.onFailure();
if (cb.getState() !== CircuitBreakerState.CLOSED) throw new Error('Should still be CLOSED after 2 failures');

cb.onFailure();
if (cb.getState() !== CircuitBreakerState.OPEN) throw new Error('Should be OPEN after 3 failures');
if (cb.canRequest()) throw new Error('Should block requests when OPEN');

// 3. Transition to HALF_OPEN after timeout
setTimeout(() => {
  if (cb.getState() !== CircuitBreakerState.HALF_OPEN) throw new Error('Should be HALF_OPEN after timeout');
  
  // 4. Test HALF_OPEN concurrency limit
  if (!cb.canRequest()) throw new Error('Should allow 1st request in HALF_OPEN');
  cb.recordRequest(); // Record the request
  
  if (cb.canRequest()) throw new Error('Should block 2nd request in HALF_OPEN');
  
  // 5. Test success transitions back to CLOSED
  cb.onSuccess();
  if (cb.getState() !== CircuitBreakerState.CLOSED) throw new Error('Should be CLOSED after success');
  
  // 6. Test failure in HALF_OPEN trips immediately to OPEN
  cb.onFailure(); // 1 failure
  cb.onFailure(); // 2 failures
  cb.onFailure(); // 3 failures -> OPEN
  
  setTimeout(() => {
    // Timeout expires -> HALF_OPEN
    cb.canRequest();
    cb.recordRequest();
    cb.onFailure(); // 1 failure in HALF_OPEN -> OPEN immediately
    if (cb.getState() !== CircuitBreakerState.OPEN) throw new Error('Should be OPEN immediately after failure in HALF_OPEN');
    
    console.log('✅ All Circuit Breaker Unit Tests Passed!');
  }, 150);

}, 150);
"`;

try {
  console.log('Running Circuit Breaker Unit Tests...');
  const output = execSync(tsxCmd, { stdio: 'inherit' });
} catch (err) {
  console.error('❌ Unit tests failed');
  process.exit(1);
}
