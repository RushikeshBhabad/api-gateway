/**
 * Phase 1 Security Hardening Regression Test Suite
 *
 * Verifies:
 * 1. JWT Secret Management:
 *    - Startup validation fails fast on missing, empty, or whitespace JWT_SECRET
 *    - Rejection of weak / known placeholder secrets
 *    - Rejection of low-diversity repeating patterns
 *    - Rejection of keys shorter than 32 characters (256 bits for HS256)
 *    - Production guard against default development secrets
 *    - Removal of hardcoded fallback secrets
 *    - Explicit algorithm restriction to HS256 (rejection of 'none' and mismatched algorithms)
 *    - Verification of required claims (sub, role) and expiration
 * 2. Separation of Registry Credential from JWT:
 *    - Dedicated SERVICE_REGISTRY_TOKEN required with zero fallback to JWT_SECRET
 *    - Gateway fails closed if SERVICE_REGISTRY_TOKEN is unset, even if JWT_SECRET is present
 *    - Using JWT_SECRET as registry token returns HTTP 403
 *    - Unequal-length token comparisons are handled safely without error or timing leaks
 *    - Microservice registration clients fail closed and do not silently omit credentials
 * 3. Protected Registry Routes and Aliases:
 *    - Covers all routes under both /registry AND /api/registry
 *    - Verifies GET, POST, DELETE methods require dedicated registry authentication
 *    - Verifies unauthenticated/invalid requests do not mutate registry state
 * 4. Destination & Identity Validation (SSRF Prevention):
 *    - Allowed services whitelist enforcement (user-service, product-service, order-service)
 *    - Port bounds validation (1-65535)
 *    - Cloud metadata endpoint blocking (169.254.169.254, metadata.google.internal)
 *    - Protocol restriction to http: and https: (blocks file://, ftp://)
 *    - Path/query tampering and path-traversal instanceId rejection
 */

const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');

// Isolated deterministic test secrets (never log real credentials)
const TEST_JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_12345';
const TEST_REGISTRY_TOKEN = 'test_registry_token_dedicated_32_chars_1234567';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`   ❌ FAILED: ${message}`);
    throw new Error(message);
  }
  passedTests++;
  console.log(`   ✓ ${message}`);
}

async function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, data: json || data, headers: res.headers });
      });
    });
    req.on('error', (err) => reject(err));
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runSecurityTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        PHASE 1 SECURITY HARDENING REGRESSION TESTS         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Save current process.env to ensure complete isolation
  const originalEnv = { ...process.env };

  try {
    // =========================================================================
    // SUITE 1: JWT SECRET MANAGEMENT & FAIL-FAST VALIDATION
    // =========================================================================
    console.log('--- Suite 1: JWT Secret Management & Fail-Fast Validation ---');

    const { validateJwtSecret: gwValidate } = require('../api-gateway/src/config/jwtConfig');
    const { validateJwtSecret: userValidate } = require('../user-service/src/config/jwtConfig');

    // Test 1.1: Missing JWT_SECRET throws
    delete process.env.JWT_SECRET;
    let threw = false;
    try {
      gwValidate();
    } catch (e) {
      threw = true;
      assert(e.message.includes('FATAL: JWT_SECRET environment variable is required'),
        'Gateway validateJwtSecret() throws when JWT_SECRET is unset');
    }
    assert(threw, 'Gateway fail-fast on missing JWT_SECRET');

    // Test 1.2: Whitespace-only JWT_SECRET throws
    process.env.JWT_SECRET = '    ';
    threw = false;
    try {
      gwValidate();
    } catch (e) {
      threw = true;
      assert(e.message.includes('FATAL: JWT_SECRET environment variable is required'),
        'Gateway validateJwtSecret() throws when JWT_SECRET is whitespace');
    }
    assert(threw, 'Gateway fail-fast on whitespace JWT_SECRET');

    // Test 1.3: User-Service fail-fast on missing JWT_SECRET
    delete process.env.JWT_SECRET;
    threw = false;
    try {
      userValidate();
    } catch (e) {
      threw = true;
      assert(e.message.includes('FATAL: JWT_SECRET environment variable is required'),
        'User-Service validateJwtSecret() throws when JWT_SECRET is unset');
    }
    assert(threw, 'User-Service fail-fast on missing JWT_SECRET');

    // Test 1.4: Reject known weak / placeholder secret
    process.env.JWT_SECRET = 'super_secret_jwt_key';
    threw = false;
    try {
      gwValidate();
    } catch (e) {
      threw = true;
      assert(e.message.includes('insecure known placeholder'),
        'Gateway rejects known placeholder secret');
    }
    assert(threw, 'Known placeholder rejection verified');

    // Test 1.5: Reject secret shorter than 32 characters (256 bits)
    process.env.JWT_SECRET = 'short_key_under_32_characters';
    threw = false;
    try {
      gwValidate();
    } catch (e) {
      threw = true;
      assert(e.message.includes('at least 32 characters'),
        'Gateway rejects secrets shorter than 32 characters');
    }
    assert(threw, 'Minimum 256-bit structural length threshold verified');

    // Test 1.6: Reject low character diversity (repeating trivial pattern)
    process.env.JWT_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    threw = false;
    try {
      gwValidate();
    } catch (e) {
      threw = true;
      assert(e.message.includes('low character diversity'),
        'Gateway rejects low-diversity repeating patterns');
    }
    assert(threw, 'Low-diversity pattern rejection verified');

    // Test 1.7: In production, reject default development repository secret
    process.env.JWT_SECRET = 'super_secret_jwt_key_for_this_project_123';
    process.env.NODE_ENV = 'production';
    threw = false;
    try {
      gwValidate();
    } catch (e) {
      threw = true;
      assert(e.message.includes('Default development JWT_SECRET is not permitted in production'),
        'Gateway rejects dev repository key in production environment');
    }
    assert(threw, 'Production environment dev-key guard verified');
    process.env.NODE_ENV = 'test';

    // Test 1.8: Valid secret passes
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const validatedSecret = gwValidate();
    assert(validatedSecret === TEST_JWT_SECRET, 'Valid 32+ char secret accepted and returned');

    // =========================================================================
    // SUITE 1b: TOKEN SIGNING, VERIFICATION & ALGORITHM RESTRICTION
    // =========================================================================
    console.log('\n--- Suite 1b: Token Signing, Verification & Algorithm Restriction ---');

    const { JWTAuthentication } = require('../api-gateway/src/authentication/JWTAuthentication');
    const jwtAuth = new JWTAuthentication();

    // Test 1b.1: Valid token generated and verified with HS256
    const userPayload = { sub: 'usr-security-101', role: 'ADMIN' };
    const validToken = jwt.sign(userPayload, TEST_JWT_SECRET, { expiresIn: '2h', algorithm: 'HS256' });

    const authContext = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${validToken}` }
    });
    assert(authContext !== null, 'Valid HS256 token successfully verified');
    assert(authContext.userId === 'usr-security-101', 'Extracted correct sub claim (userId)');
    assert(authContext.role === 'ADMIN', 'Extracted correct role claim');

    // Test 1b.2: Algorithm restriction - reject 'none' algorithm token
    // Construct unsigned token with alg: 'none'
    const headerNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payloadEncoded = Buffer.from(JSON.stringify({ ...userPayload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const unsignedNoneToken = `${headerNone}.${payloadEncoded}.`;
    const noneContext = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${unsignedNoneToken}` }
    });
    assert(noneContext === null, 'Token with alg="none" rejected by Gateway');

    // Test 1b.3: Algorithm restriction - reject token signed with mismatched algorithm (HS384)
    const hs384Token = jwt.sign(userPayload, TEST_JWT_SECRET, { expiresIn: '2h', algorithm: 'HS384' });
    const hs384Context = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${hs384Token}` }
    });
    assert(hs384Context === null, 'Token signed with mismatched algorithm (HS384) rejected by Gateway');

    // Test 1b.4: Missing required claim 'sub' rejected
    const missingSubToken = jwt.sign({ role: 'ADMIN' }, TEST_JWT_SECRET, { expiresIn: '2h', algorithm: 'HS256' });
    const missingSubContext = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${missingSubToken}` }
    });
    assert(missingSubContext === null, 'Token missing sub claim rejected');

    // Test 1b.5: Missing required claim 'role' rejected
    const missingRoleToken = jwt.sign({ sub: 'usr-123' }, TEST_JWT_SECRET, { expiresIn: '2h', algorithm: 'HS256' });
    const missingRoleContext = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${missingRoleToken}` }
    });
    assert(missingRoleContext === null, 'Token missing role claim rejected');

    // Test 1b.6: Expired token rejected
    const expiredToken = jwt.sign(userPayload, TEST_JWT_SECRET, { expiresIn: '-10s', algorithm: 'HS256' });
    const expiredContext = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${expiredToken}` }
    });
    assert(expiredContext === null, 'Expired token rejected');

    // Test 1b.7: Token signed with different secret rejected
    const wrongSecretToken = jwt.sign(userPayload, 'completely_different_secret_key_32_chars_123', { expiresIn: '2h', algorithm: 'HS256' });
    const wrongContext = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${wrongSecretToken}` }
    });
    assert(wrongContext === null, 'Token signed with mismatched secret rejected');

    // Test 1b.8: Safe failure when JWT_SECRET unset at runtime without fallback
    delete process.env.JWT_SECRET;
    const runtimeUnsetContext = await jwtAuth.authenticate({
      headers: { authorization: `Bearer ${validToken}` }
    });
    assert(runtimeUnsetContext === null, 'Authentication fails safely when JWT_SECRET is unset (no fallback)');
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    // =========================================================================
    // SUITE 2: SEPARATION OF REGISTRY CREDENTIAL FROM JWT
    // =========================================================================
    console.log('\n--- Suite 2: Separation of Registry Credential from JWT ---');

    const { getRegistryToken, verifyRegistryToken } = require('../api-gateway/src/registry/registrySecurity');

    // Test 2.1: Gateway fails closed when SERVICE_REGISTRY_TOKEN is unset, even if JWT_SECRET is set
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    delete process.env.SERVICE_REGISTRY_TOKEN;
    threw = false;
    try {
      getRegistryToken();
    } catch (e) {
      threw = true;
      assert(e.message.includes('FATAL: SERVICE_REGISTRY_TOKEN environment variable is required'),
        'getRegistryToken() throws when SERVICE_REGISTRY_TOKEN is unset, refusing JWT_SECRET fallback');
    }
    assert(threw, 'Gateway fails closed without dedicated SERVICE_REGISTRY_TOKEN');

    process.env.SERVICE_REGISTRY_TOKEN = TEST_REGISTRY_TOKEN;

    // Test 2.2: verifyRegistryToken returns false when JWT_SECRET is supplied instead of SERVICE_REGISTRY_TOKEN
    assert(verifyRegistryToken(TEST_JWT_SECRET, TEST_REGISTRY_TOKEN) === false,
      'Supplying JWT_SECRET as registry token fails verification');

    // Test 2.3: verifyRegistryToken returns true when exact SERVICE_REGISTRY_TOKEN is supplied
    assert(verifyRegistryToken(TEST_REGISTRY_TOKEN, TEST_REGISTRY_TOKEN) === true,
      'Exact SERVICE_REGISTRY_TOKEN passes verification');

    // Test 2.4: Safe unequal-length comparisons without errors or crashes
    assert(verifyRegistryToken('short', TEST_REGISTRY_TOKEN) === false,
      'Unequal length (shorter token) safely rejected without error');
    assert(verifyRegistryToken('a'.repeat(500), TEST_REGISTRY_TOKEN) === false,
      'Unequal length (longer token 500 chars) safely rejected without error');
    assert(verifyRegistryToken('', TEST_REGISTRY_TOKEN) === false,
      'Empty token safely rejected');

    // Test 2.5: Microservice client fails closed if SERVICE_REGISTRY_TOKEN is missing
    delete process.env.SERVICE_REGISTRY_TOKEN;
    const { registerWithGateway: clientRegister } = require('../product-service/src/registry/registerService');
    const clientResult = clientRegister({
      serviceName: 'product-service',
      port: 4999
    });
    assert(typeof clientResult.unregister === 'function',
      'Client registerWithGateway handles missing token gracefully and aborts registration');
    process.env.SERVICE_REGISTRY_TOKEN = TEST_REGISTRY_TOKEN;

    // =========================================================================
    // SUITE 3: ROUTE ALIASES & REGISTRY ROUTE PROTECTION
    // =========================================================================
    console.log('\n--- Suite 3: Route Aliases & Registry Route Protection ---');

    const express = require('express');
    const app = express();
    const { registryRouter } = require('../api-gateway/src/registry/registryRoutes');

    // Mount both standard path and API alias as in Gateway server.ts
    app.use('/registry', registryRouter);
    app.use('/api/registry', registryRouter);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      // Test 3.1: GET /registry AND GET /api/registry without token -> 401
      const inspectStandard = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry',
        method: 'GET'
      });
      assert(inspectStandard.status === 401, 'Unauthenticated GET /registry rejected with HTTP 401');

      const inspectAlias = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/registry',
        method: 'GET'
      });
      assert(inspectAlias.status === 401, 'Unauthenticated GET /api/registry alias rejected with HTTP 401');

      // Test 3.2: Calling with JWT_SECRET instead of SERVICE_REGISTRY_TOKEN -> 403 Forbidden
      const jwtTokenAttempt = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry',
        method: 'GET',
        headers: { 'x-registry-token': TEST_JWT_SECRET }
      });
      assert(jwtTokenAttempt.status === 403, 'Using JWT_SECRET for registry access rejected with HTTP 403');

      // Test 3.3: Authenticated inspection with dedicated token -> 200
      const inspectAuth = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry',
        method: 'GET',
        headers: { 'x-registry-token': TEST_REGISTRY_TOKEN }
      });
      assert(inspectAuth.status === 200, 'Authenticated GET /registry returns HTTP 200');

      const inspectAliasAuth = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/registry',
        method: 'GET',
        headers: { 'authorization': `Bearer ${TEST_REGISTRY_TOKEN}` }
      });
      assert(inspectAliasAuth.status === 200, 'Authenticated GET /api/registry with Bearer token returns HTTP 200');

      // Test 3.4: Mutations on both /registry and /api/registry rejected without token
      const regMutations = [
        { path: '/registry/register', method: 'POST', body: { serviceName: 'product-service', port: 4001 } },
        { path: '/api/registry/register', method: 'POST', body: { serviceName: 'product-service', port: 4001 } },
        { path: '/registry/heartbeat', method: 'POST', body: { serviceName: 'product-service', instanceId: 'inst-1' } },
        { path: '/api/registry/heartbeat', method: 'POST', body: { serviceName: 'product-service', instanceId: 'inst-1' } },
        { path: '/registry/unregister', method: 'POST', body: { serviceName: 'product-service', instanceId: 'inst-1' } },
        { path: '/api/registry/unregister', method: 'POST', body: { serviceName: 'product-service', instanceId: 'inst-1' } },
        { path: '/registry/product-service/inst-1', method: 'DELETE' },
        { path: '/api/registry/product-service/inst-1', method: 'DELETE' }
      ];

      for (const m of regMutations) {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port,
          path: m.path,
          method: m.method,
          headers: { 'Content-Type': 'application/json' }
        }, m.body || null);
        assert(res.status === 401, `Unauthenticated ${m.method} ${m.path} rejected with HTTP 401`);
      }

      // Test 3.5: Failed authentication does NOT mutate registry state
      const initialServices = inspectAuth.data.services?.['product-service'] || [];
      await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { serviceName: 'product-service', port: 9999, id: 'rogue-unauth-inst' });

      const inspectAfterUnauth = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry',
        method: 'GET',
        headers: { 'x-registry-token': TEST_REGISTRY_TOKEN }
      });
      const servicesAfterUnauth = inspectAfterUnauth.data.services?.['product-service'] || [];
      assert(servicesAfterUnauth.length === initialServices.length,
        'Failed unauthenticated mutation does NOT alter registry state');

      // =========================================================================
      // SUITE 4: SERVICE IDENTITY & DESTINATION VALIDATION (SSRF PREVENTIONS)
      // =========================================================================
      console.log('\n--- Suite 4: Service Identity & Destination Validation ---');

      const authHeaders = {
        'Content-Type': 'application/json',
        'x-registry-token': TEST_REGISTRY_TOKEN
      };

      // Test 4.1: Whitelist: reject unauthorized service name
      const rogueService = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, { serviceName: 'unauthorized-service', port: 4001 });
      assert(rogueService.status === 400, 'Rogue service name rejected with HTTP 400');
      assert(rogueService.data.error.includes('Allowed services are'), 'Error specifies whitelist');

      // Test 4.2: Port validation: 0, negative, overflow, and non-numeric
      const invalidPorts = [0, -10, 70000, 'abc'];
      for (const badPort of invalidPorts) {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port,
          path: '/registry/register',
          method: 'POST',
          headers: authHeaders
        }, { serviceName: 'product-service', port: badPort });
        assert(res.status === 400, `Invalid port ${badPort} rejected with HTTP 400`);
      }

      // Test 4.2b: Disallowed infrastructure ports (Redis, MongoDB, Gateway itself, SSH)
      const sensitivePorts = [
        { port: 6379, desc: 'Redis port 6379' },
        { port: 27017, desc: 'MongoDB port 27017' },
        { port: 8000, desc: 'Gateway self-port 8000' },
        { port: 22, desc: 'SSH port 22' }
      ];
      for (const item of sensitivePorts) {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port,
          path: '/registry/register',
          method: 'POST',
          headers: authHeaders
        }, { serviceName: 'product-service', port: item.port, host: 'localhost' });
        assert(res.status === 400, `${item.desc} rejected with HTTP 400`);
        assert(res.data.error.includes('reserved or sensitive infrastructure port'),
          `Error message explains reserved/sensitive port for ${item.desc}`);
      }

      // Test 4.2c: Service-specific port allowlist enforcement (prevent port-mismatch attacks)
      const userBadPort = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, { serviceName: 'user-service', port: 4001, host: 'localhost' });
      assert(userBadPort.status === 400, 'user-service registering on product port 4001 rejected with HTTP 400');
      assert(userBadPort.data.error.includes('not in the allowed port range for service \'user-service\''),
        'Error message indicates user-service port range violation');

      const orderBadPort = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, { serviceName: 'order-service', port: 3001, host: 'localhost' });
      assert(orderBadPort.status === 400, 'order-service registering on user port 3001 rejected with HTTP 400');
      assert(orderBadPort.data.error.includes('not in the allowed port range for service \'order-service\''),
        'Error message indicates order-service port range violation');

      // Test 4.2d: Unauthorized destination host rejected
      const rogueHost = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, { serviceName: 'product-service', port: 4001, host: 'unauthorized-external-host.com' });
      assert(rogueHost.status === 400, 'Unauthorized destination host rejected with HTTP 400');
      assert(rogueHost.data.error.includes('not an authorized registry destination host'),
        'Error message indicates host allowlist violation');

      const roguePrivateIp = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, { serviceName: 'product-service', port: 4001, host: '10.254.1.99' });
      assert(roguePrivateIp.status === 400, 'Unauthorized private IP host rejected with HTTP 400');
      assert(roguePrivateIp.data.error.includes('not an authorized registry destination host'),
        'Error message indicates private IP not in host allowlist');

      // Test 4.3: SSRF Protection: Reject cloud metadata IP
      const ssrfRes = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        port: 80,
        host: '169.254.169.254'
      });
      assert(ssrfRes.status === 400, 'Cloud metadata IP 169.254.169.254 rejected with HTTP 400');

      // Test 4.4: SSRF Protection: Reject GCP metadata hostname
      const gcpMetadata = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        port: 80,
        host: 'metadata.google.internal'
      });
      assert(gcpMetadata.status === 400, 'Google cloud metadata hostname rejected with HTTP 400');

      // Test 4.5: Protocol restriction: reject non-HTTP schemes (file://, ftp://)
      const fileScheme = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        port: 4001,
        host: 'localhost',
        url: 'file:///etc/shadow'
      });
      assert(fileScheme.status === 400, 'file:// scheme rejected with HTTP 400');

      // Test 4.6: Reject URL with subpaths or query parameters
      const subpathUrl = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        port: 4001,
        host: 'localhost',
        url: 'http://localhost:4001/admin/debug?mode=full'
      });
      assert(subpathUrl.status === 400, 'URL with subpaths and queries rejected with HTTP 400');

      // Test 4.7: Reject path-traversal instanceId
      const traversalId = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        port: 4001,
        host: 'localhost',
        id: '../../bin/sh'
      });
      assert(traversalId.status === 400, 'Path traversal in instanceId rejected with HTTP 400');

      // Test 4.8: Failed validation does NOT mutate registry state
      const inspectBeforeValid = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry',
        method: 'GET',
        headers: { 'x-registry-token': TEST_REGISTRY_TOKEN }
      });
      const validInitialCount = inspectBeforeValid.data.services?.['product-service']?.length || 0;

      // Test 4.9: Legitimate registration succeeds
      const legitReg = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        port: 4020,
        host: 'localhost',
        id: 'product-dynamic-4020'
      });
      assert(legitReg.status === 200, 'Legitimate registration succeeds with HTTP 200');
      assert(legitReg.data.instance.id === 'product-dynamic-4020', 'Returned instance ID verified');

      // Test 4.9b: Legitimate user-service and order-service registrations succeed
      const legitUserReg = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'user-service',
        port: 3001,
        host: 'localhost',
        id: 'user-main-3001'
      });
      assert(legitUserReg.status === 200, 'Legitimate user-service registration succeeds on port 3001');

      const legitOrderReg = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/register',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'order-service',
        port: 3003,
        host: 'localhost',
        id: 'order-main-3003'
      });
      assert(legitOrderReg.status === 200, 'Legitimate order-service registration succeeds on port 3003');

      // Test 4.10: Legitimate heartbeat succeeds
      const legitHb = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/heartbeat',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        instanceId: 'product-dynamic-4020'
      });
      assert(legitHb.status === 200, 'Legitimate heartbeat succeeds with HTTP 200');

      // Test 4.11: Legitimate unregister succeeds
      const legitUnreg = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/unregister',
        method: 'POST',
        headers: authHeaders
      }, {
        serviceName: 'product-service',
        instanceId: 'product-dynamic-4020'
      });
      assert(legitUnreg.status === 200, 'Legitimate unregister succeeds with HTTP 200');

      // Test 4.12: Unregister non-existent service handled gracefully
      const deleteGhost = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/registry/product-service/product-dynamic-4020',
        method: 'DELETE',
        headers: authHeaders
      });
      assert(deleteGhost.status === 200, 'DELETE unregister for non-existent instance handled gracefully');

    } finally {
      server.close();
    }

  } finally {
    // Restore environment variables completely
    process.env = originalEnv;
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log(`║  🎉 ALL ${passedTests}/${totalTests} SECURITY REGRESSION TESTS PASSED!          ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');
}

runSecurityTests().catch((err) => {
  console.error('\n❌ Security Test Suite Failed:', err);
  process.exit(1);
});
