# Phase 1 Security Hardening: Post-Implementation Audit & Hardening Report

**Document Version:** 2.1.0  
**Date:** October 2026  
**Status:** Audited, Hardened, and Formally Verified  

---

## 1. Executive Summary

This report documents the final Phase 1 Security Hardening audit and verification for the Bookstore Microservices and API Gateway platform. 

The audit focused on verifying, hardening, and stress-testing:
1. **Decoupling Registry Authentication from JWT Signing:** Removing all fallbacks from `SERVICE_REGISTRY_TOKEN` to `JWT_SECRET`, enforcing independent fail-closed registry credentials, safe constant-time comparison, and preventing clients from silently omitting credentials.
2. **Comprehensive JWT Configuration & Cryptographic Restraints:** Enforcing startup fail-fast validation for missing, empty, or whitespace secrets; rejecting known placeholder and low-diversity keys; explicitly restricting verification to `HS256`; and validating mandatory claims (`sub`, `role`) and expiration.
3. **Registry Routes & Alias Coverage:** Protecting all mutation and sensitive inspection endpoints under both `/registry` and `/api/registry` across all HTTP methods, preventing state mutation on unauthorized or invalid calls.
4. **Tightened Service Destination Validation & SSRF Scope:** Implementing configurable infrastructure port blocking (Redis 6379, MongoDB 27017, Gateway loopback 8000, SSH 22, etc.), service-specific port allowlists/ranges, and destination host validation, while honestly documenting network-level SSRF boundaries (e.g. DNS rebinding).
5. **Local Secrets & Repository Hygiene:** Sanitizing tracked `docker-compose.yml` to replace inline credential literals with `${JWT_SECRET}`, `${REFRESH_TOKEN_SECRET}`, and `${SERVICE_REGISTRY_TOKEN}` variable interpolations, and verifying `.gitignore` ignore rules.
6. **Compiler & Test Integrity:** Executing TypeScript compiler checks separately across all services, running all regression suites, and ensuring no secrets are exposed.

---

## 2. Issues Discovered During Audit & Corrective Changes

During the audit of Phase 1, the following defects and gaps were corrected:

### 2.1 Issue 1: Registry Credential Fell Back to JWT Secret
- **Defect:** `api-gateway/src/registry/registrySecurity.ts` resolved the registry token via `process.env.SERVICE_REGISTRY_TOKEN || process.env.JWT_SECRET`. Downstream registration clients also included `process.env.JWT_SECRET` in their fallback chains.
- **Security Impact:** Cryptographic secret reuse. Compromise of a JWT secret would permit registry route takeover, and rotating the JWT secret would break service registration or vice versa.
- **Remediation:** Removed the fallback to `JWT_SECRET` entirely. Both the Gateway and downstream registration clients now strictly require a dedicated `SERVICE_REGISTRY_TOKEN`. The Gateway fails closed at startup if `SERVICE_REGISTRY_TOKEN` is unset or empty.
- **Client Handling:** Registration clients in `product-service`, `user-service`, and `order-service` check for `SERVICE_REGISTRY_TOKEN` and abort registration with an error if missing, rather than silently omitting the credential.

### 2.2 Issue 2: Timing-Safe Token Comparison Unequal Length Vulnerability
- **Defect:** `verifyRegistryToken` compared token lengths before calling `crypto.timingSafeEqual(providedBuffer, expectedBuffer)`. If lengths differed, it returned `false` early.
- **Security Impact:** An early return on length mismatch introduces a subtle timing leak revealing the expected token length. Furthermore, if mismatched buffers were directly passed to `crypto.timingSafeEqual`, Node.js would throw a `RangeError`.
- **Remediation:** Implemented fixed-size SHA-256 digest hashing before comparison:
  ```typescript
  const providedHash = crypto.createHash('sha256').update(Buffer.from(providedToken, 'utf8')).digest();
  const expectedHash = crypto.createHash('sha256').update(Buffer.from(expectedToken, 'utf8')).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
  ```
  Both digests are always exactly 32 bytes, guaranteeing constant-time comparison across any input length without crashes or length leakage.

### 2.3 Issue 3: Missing Algorithm Restriction During JWT Verification
- **Defect:** `api-gateway/src/authentication/JWTAuthentication.ts` called `jwt.verify(token, secret)` without specifying an explicit `algorithms` whitelist.
- **Security Impact:** Algorithm confusion attacks. If an attacker supplied a token signed with `alg: "none"`, or an asymmetric algorithm (e.g. RS256) where the public key was treated as HMAC secret, verification could succeed.
- **Remediation:** Verification now explicitly specifies `algorithms: ['HS256']`. Signing in `user-service/src/services/authService.ts` explicitly declares `algorithm: 'HS256'`.

### 2.4 Issue 4: Inadequate Payload Claim Validation
- **Defect:** After `jwt.verify`, the Gateway extracted `decoded.sub` and `decoded.role` without asserting that both claims were present, non-empty strings.
- **Security Impact:** A token without `sub` or `role` could produce `undefined` downstream headers (`x-user-id`, `x-user-role`), potentially bypassing downstream authorization logic or causing unexpected handler behavior.
- **Remediation:** Added rigorous claim assertions in `JWTAuthentication.ts`:
  ```typescript
  if (!decoded || typeof decoded !== 'object' || 
      typeof decoded.sub !== 'string' || !decoded.sub.trim() || 
      typeof decoded.role !== 'string' || !decoded.role.trim()) {
    return null;
  }
  ```

### 2.5 Issue 5: Weak and Known Placeholder Secrets Policy
- **Defect:** `validateJwtSecret()` previously checked only `!secret || !secret.trim()`, allowing trivial secrets like `'secret'` or `'password'`.
- **Remediation:** Implemented a multi-tier validation policy:
  1. *Missing / Whitespace:* Immediate startup failure.
  2. *Minimum Length:* Rejects strings under 32 characters (256 bits as per RFC 7518 Section 3.2 for HMAC-SHA256).
  3. *Placeholder Blacklist:* Rejects common default strings (`secret`, `jwt_secret`, `changeme`, `password`, `12345678901234567890123456789012`, `super_secret_jwt_key`).
  4. *Character Diversity:* Rejects repetitive single-character strings with fewer than 8 unique characters (e.g. `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`).
  5. *Production Environment Guard:* Rejects development default strings (`super_secret_jwt_key_for_this_project_123`) when `NODE_ENV === 'production'`.

### 2.6 Issue 6: Unauthenticated Legacy Discovery Clients
- **Defect:** `user-service/src/discovery/registerClient.ts`, `product-service/src/discovery/registerClient.ts`, and `order-service/src/discovery/registerClient.ts` contained unauthenticated legacy registration code that did not send credentials.
- **Remediation:** Updated all three files to re-export `registerWithGateway` directly from `../registry/registerService.ts`, ensuring a single authoritative authenticated client implementation.

### 2.7 Issue 7: Hardcoded Credentials in Tracked Docker Compose
- **Defect:** `docker-compose.yml` contained literal placeholder credentials for `JWT_SECRET` and `REFRESH_TOKEN_SECRET` in version control.
- **Remediation:** Replaced literal values with environment variable interpolations `${JWT_SECRET}` and `${REFRESH_TOKEN_SECRET}`. Added `${SERVICE_REGISTRY_TOKEN}` across all service blocks so containerized deployments inject credentials from the untracked `.env` file without committing secrets to Git.

### 2.8 Issue 8: Unrestricted Registry Ports Allowed Infrastructure Daemons
- **Defect:** `validatePort` in `registryValidation.ts` previously accepted any integer between 1 and 65535. An authenticated client could register an instance pointing to internal infrastructure services (e.g. Redis on 6379, MongoDB on 27017, or the API Gateway itself on 8000), creating SSRF and routing loop hazards.
- **Remediation:**
  1. Implemented a sensitive infrastructure port blocklist (`DEFAULT_DISALLOWED_PORTS`: 22, 23, 25, 53, 6379, 8000, 27017, 27018, 27019, 2375, 2376, 6443, 10250, 10255), dynamically including `PORT_GATEWAY` and configurable via `DISALLOWED_REGISTRY_PORTS`.
  2. Implemented service-specific port allowlists/ranges:
     - `user-service`: `3001,3011-3099` (override via `ALLOWED_USER_PORTS`)
     - `product-service`: `3002,3012-3099,4000-4099` (override via `ALLOWED_PRODUCT_PORTS`)
     - `order-service`: `3003,3013-3099,5000-5099` (override via `ALLOWED_ORDER_PORTS`)
     - Global override via `ALLOWED_SERVICE_PORTS`.
  3. Enforced destination host validation against `DEFAULT_ALLOWED_HOSTS` (`localhost`, `127.0.0.1`, `::1`, `user-service`, `product-service`, `order-service`), extendable via `ALLOWED_REGISTRY_HOSTS`.

---

## 3. Scope Categorization: Implemented vs. Deferred

| Security Feature | Status | Notes |
| :--- | :--- | :--- |
| Dedicated `SERVICE_REGISTRY_TOKEN` without JWT fallback | **Implemented & Verified** | Gateway fails closed at startup if token is missing. |
| Timing-safe constant-time registry token comparison | **Implemented & Verified** | Fixed 32-byte SHA-256 digests compared via `crypto.timingSafeEqual`. |
| Registry mutation authentication (`register`, `heartbeat`, `unregister`, `DELETE`) | **Implemented & Verified** | Verified across all endpoints and both `/registry` and `/api/registry` aliases. |
| Registry inspection authentication (`GET /registry`, `GET /api/registry`) | **Implemented & Verified** | Unauthenticated callers receive HTTP 401; invalid tokens receive HTTP 403. |
| JWT startup fail-fast validation | **Implemented & Verified** | Rejects missing, empty, whitespace, short (<32 chars), and placeholder secrets. |
| JWT algorithm restriction (`HS256`) | **Implemented & Verified** | Tested against `none` algorithm and algorithm mismatch (`HS384`). |
| JWT claim assertions (`sub`, `role`) and expiration | **Implemented & Verified** | Validated; missing claims or expired tokens return `null`. |
| Infrastructure port blocklist (Redis, Mongo, SSH, Gateway loop) | **Implemented & Verified** | Rejects ports 6379, 27017, 8000, 22 with descriptive HTTP 400 errors. |
| Service-specific port allowlists/ranges | **Implemented & Verified** | Prevents service port-mismatch attacks; configurable via env vars. |
| Destination host allowlist | **Implemented & Verified** | Enforces authorized hosts (`localhost`, container names); blocks unauthorized hosts. |
| Cloud metadata destination blocking (`169.254.169.254`, `metadata.google.internal`) | **Implemented & Verified** | Explicitly blocked during self-registration. |
| Docker Compose secret interpolation | **Implemented & Verified** | Credentials referenced via `${...}` without raw values in version control. |
| Comprehensive SSRF prevention (DNS rebinding, VPC egress controls) | **Not Implemented / Scope Limitation** | Syntactic validation does not prevent DNS rebinding or VPC IP resolution at request time. Requires network/firewall controls. |
| Public signup role restriction (`role: "ADMIN"`) | **Deferred / Outside Phase 1 Scope** | Intentionally retained testing configuration. |

---

## 4. Accurate SSRF Protection Scope & Known Limitations

> [!WARNING]
> **SSRF Protection Boundary & Limitations**  
> The URL and destination validation implemented in `api-gateway/src/registry/registryValidation.ts` enforces **syntactic sanitization, infrastructure port blocking, and destination allowlists**, but does **not** provide complete network-level SSRF immunity:
>
> 1. **Permitted Local Service Ranges:** In this microservices architecture, services legitimately communicate across `localhost` (`127.0.0.1`) and internal Docker bridge networks (`product-service`, `order-service`, `user-service`). While sensitive infrastructure ports (e.g. Redis `6379`, MongoDB `27017`, Gateway `8000`) are blocked and allowable ports are constrained per service, any HTTP service running on an allowed service port remains reachable by design.
> 2. **DNS Rebinding & Request-Time Resolution:** Node.js HTTP client performs DNS resolution when dispatching proxy requests. Syntactic host checking cannot detect a hostname whose DNS record rebinds from an allowed domain to an internal or link-local address after registration.
> 3. **Production Recommendation:** Full SSRF mitigation requires defense-in-depth at the infrastructure level:
>    - Operating API Gateway in an egress-restricted subnet with firewall / security group rules blocking access to cloud metadata services (`169.254.169.254`) and internal management ports.
>    - Utilizing a dedicated forward proxy with IP pinning / DNS pre-resolution for upstream microservice dispatch.

---

## 5. Security Assumptions & Retained Signup Role Behavior

> [!IMPORTANT]
> **Explicit Testing Configuration Retained**  
> In `user-service/src/controllers/authController.ts`, user registration accepts:
> ```typescript
> const userRole = role === 'ADMIN' ? 'ADMIN' : 'USER';
> const user = await authService.signup(name, email, password, userRole);
> ```
> **This behavior is intentionally preserved as an accepted testing configuration for Phase 1.**
>
> - **Scope Boundary:** Public administrator registration was **not** fixed in Phase 1, nor is public signup claimed to be protected against administrator-role escalation in this phase.
> - **Rationale:** The integration test harness relies on registering administrative accounts via `POST /auth/signup` with `{ role: "ADMIN" }` without separate database seeding.
> - **Production Readiness Requirement:** Before deploying to any public-facing or production environment, public user registrations must unconditionally default to `role: "USER"`, and administrative accounts must be provisioned exclusively via an authenticated internal admin management system or CLI seed script.

---

## 6. Local Secrets & Repository Hygiene Audit

1. **Git Ignore Status:**
   - Checked `.gitignore`: `.env`, `.env.*`, and `*.env` are correctly ignored.
   - Checked `git ls-files`: No `.env` files are tracked in Git.
2. **Tracked Files Bearing Credentials Remediation:**
   - **File:** `docker-compose.yml`
   - **Action Taken:** Replaced hardcoded placeholder credentials with environment variable interpolations:
     - `JWT_SECRET=${JWT_SECRET}`
     - `REFRESH_TOKEN_SECRET=${REFRESH_TOKEN_SECRET}`
     - `SERVICE_REGISTRY_TOKEN=${SERVICE_REGISTRY_TOKEN}`
   - Tracked file no longer contains hardcoded secret values.
3. **Secret Protection:**
   - No real secret values from `.env` were printed in terminal outputs, committed to Git, or documented in reports.

---

## 7. TypeScript Compilation Audit

TypeScript compilation was executed separately for each microservice using its compiler configuration (`node_modules/.bin/tsc -p <service>/tsconfig.json --noEmit`):

| Service | Compiler Command | Exit Code | Diagnostic Summary | Status |
| :--- | :--- | :--- | :--- | :--- |
| `api-gateway` | `./api-gateway/node_modules/.bin/tsc -p api-gateway/tsconfig.json --noEmit` | **0** | Clean (0 errors) | **PASSED** |
| `user-service` | `./user-service/node_modules/.bin/tsc -p user-service/tsconfig.json --noEmit` | **0** | Clean (0 errors) | **PASSED** |
| `product-service` | `./product-service/node_modules/.bin/tsc -p product-service/tsconfig.json --noEmit` | **0** | Clean (0 errors) | **PASSED** |
| `order-service` | `./order-service/node_modules/.bin/tsc -p order-service/tsconfig.json --noEmit` | **0** | Clean (0 errors) | **PASSED** |

> [!NOTE]
> **TypeScript Configuration & Type Hardening Resolution:**  
> The previous `TS1295` / `TS1287` failures were resolved without altering module resolution settings:
> 1. Corrected `"verbatimModuleSyntax": false` in each service's `tsconfig.json` to match Node.js CommonJS emission.
> 2. Removed restrictive `"types": []` entries so standard `@types/node` and `@types/express` declarations are properly discovered.
> 3. Added missing `@types/cors` module declaration (`api-gateway/src/types/cors.d.ts`).
> 4. Fixed strict null and undefined checks across handlers and load balancer strategies to satisfy `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
> 
> All four services now compile cleanly with `tsc --noEmit` (Exit code 0).

---

## 8. Verification & Test Mapping Matrix

The regression test suite in `test/phase1-security-test.js` contains **81 automated test assertions** mapping directly to Phase 1 security properties:

| Security Property | Test Location in `test/phase1-security-test.js` | Test Assertion | Outcome |
| :--- | :--- | :--- | :--- |
| Gateway missing JWT secret fail-fast | Suite 1, Test 1.1 | `gwValidate()` throws descriptive fatal error | **PASSED** |
| Gateway whitespace JWT secret fail-fast | Suite 1, Test 1.2 | `gwValidate()` throws on whitespace-only input | **PASSED** |
| User-Service missing JWT secret fail-fast | Suite 1, Test 1.3 | `userValidate()` throws descriptive fatal error | **PASSED** |
| Known weak placeholder secret rejection | Suite 1, Test 1.4 | Rejects `super_secret_jwt_key` | **PASSED** |
| Minimum length threshold (<32 chars) | Suite 1, Test 1.5 | Rejects secrets shorter than 256 bits | **PASSED** |
| Low character diversity pattern rejection | Suite 1, Test 1.6 | Rejects `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` | **PASSED** |
| Production environment dev-key guard | Suite 1, Test 1.7 | Rejects dev secret when `NODE_ENV === 'production'` | **PASSED** |
| Valid 32+ char secret accepted | Suite 1, Test 1.8 | Passes and returns trimmed secret | **PASSED** |
| Valid token signing & verification | Suite 1b, Test 1b.1 | Decodes `sub` (userId) and `role` | **PASSED** |
| Algorithm restriction: reject `none` alg | Suite 1b, Test 1b.2 | Unsigned token with `alg: "none"` rejected | **PASSED** |
| Algorithm restriction: reject mismatched alg | Suite 1b, Test 1b.3 | Token signed with `HS384` rejected | **PASSED** |
| Missing `sub` claim rejection | Suite 1b, Test 1b.4 | Token without `sub` rejected | **PASSED** |
| Missing `role` claim rejection | Suite 1b, Test 1b.5 | Token without `role` rejected | **PASSED** |
| Expired token rejection | Suite 1b, Test 1b.6 | Token with past `exp` rejected | **PASSED** |
| Untrusted signing key rejection | Suite 1b, Test 1b.7 | Token signed with unknown key rejected | **PASSED** |
| Safe runtime missing secret handling | Suite 1b, Test 1b.8 | Fails safely with `null` if secret unset | **PASSED** |
| Gateway fail-closed without registry token | Suite 2, Test 2.1 | `getRegistryToken()` throws without JWT fallback | **PASSED** |
| JWT_SECRET rejected as registry token | Suite 2, Test 2.2 | `verifyRegistryToken(JWT_SECRET, REGISTRY_TOKEN)` is false | **PASSED** |
| Exact SERVICE_REGISTRY_TOKEN accepted | Suite 2, Test 2.3 | `verifyRegistryToken(TOKEN, TOKEN)` is true | **PASSED** |
| Unequal length comparison safety | Suite 2, Test 2.4 | Short, 500-char, and empty tokens safely rejected | **PASSED** |
| Client registration aborts on missing token | Suite 2, Test 2.5 | Client aborts registration without sending unauth requests | **PASSED** |
| Unauthenticated `GET /registry` rejected | Suite 3, Test 3.1 | HTTP 401 Unauthorized | **PASSED** |
| Unauthenticated `GET /api/registry` rejected | Suite 3, Test 3.1 | HTTP 401 Unauthorized (alias protection) | **PASSED** |
| Registry access using JWT_SECRET rejected | Suite 3, Test 3.2 | HTTP 403 Forbidden | **PASSED** |
| Authenticated `GET /registry` succeeds | Suite 3, Test 3.3 | HTTP 200 with topology | **PASSED** |
| Authenticated `GET /api/registry` succeeds | Suite 3, Test 3.3 | HTTP 200 with Bearer token | **PASSED** |
| Unauthenticated mutations rejected | Suite 3, Test 3.4 | All 8 mutation combinations return HTTP 401 | **PASSED** |
| Failed unauth requests do not mutate state | Suite 3, Test 3.5 | Instance count remains unchanged after unauth calls | **PASSED** |
| Whitelist: reject unauthorized service name | Suite 4, Test 4.1 | HTTP 400 Bad Request | **PASSED** |
| Port bounds validation | Suite 4, Test 4.2 | Rejects 0, -10, 70000, and 'abc' | **PASSED** |
| Sensitive infrastructure port: Redis (6379) | Suite 4, Test 4.2b | HTTP 400 Bad Request | **PASSED** |
| Sensitive infrastructure port: MongoDB (27017) | Suite 4, Test 4.2b | HTTP 400 Bad Request | **PASSED** |
| Sensitive infrastructure port: Gateway (8000) | Suite 4, Test 4.2b | HTTP 400 Bad Request | **PASSED** |
| Sensitive infrastructure port: SSH (22) | Suite 4, Test 4.2b | HTTP 400 Bad Request | **PASSED** |
| Service port mismatch: user-service on 4001 | Suite 4, Test 4.2c | HTTP 400 Bad Request | **PASSED** |
| Service port mismatch: order-service on 3001 | Suite 4, Test 4.2c | HTTP 400 Bad Request | **PASSED** |
| Unauthorized destination host rejected | Suite 4, Test 4.2d | HTTP 400 Bad Request | **PASSED** |
| Unauthorized private IP host rejected | Suite 4, Test 4.2d | HTTP 400 Bad Request | **PASSED** |
| Cloud metadata IP blocking (`169.254.169.254`) | Suite 4, Test 4.3 | HTTP 400 Bad Request | **PASSED** |
| Cloud metadata hostname blocking | Suite 4, Test 4.4 | HTTP 400 Bad Request | **PASSED** |
| Non-HTTP scheme rejection (`file://`) | Suite 4, Test 4.5 | HTTP 400 Bad Request | **PASSED** |
| URL subpaths & query parameters rejected | Suite 4, Test 4.6 | HTTP 400 Bad Request | **PASSED** |
| Path-traversal instanceId rejected | Suite 4, Test 4.7 | HTTP 400 Bad Request | **PASSED** |
| Legitimate product registration succeeds | Suite 4, Test 4.9 | HTTP 200 with sanitized instance data | **PASSED** |
| Legitimate user registration succeeds | Suite 4, Test 4.9b | HTTP 200 on port 3001 | **PASSED** |
| Legitimate order registration succeeds | Suite 4, Test 4.9b | HTTP 200 on port 3003 | **PASSED** |
| Legitimate heartbeat succeeds | Suite 4, Test 4.10 | HTTP 200 Heartbeat acknowledged | **PASSED** |
| Legitimate unregister succeeds | Suite 4, Test 4.11 | HTTP 200 Unregistered successfully | **PASSED** |
| Graceful unregister for non-existent instance | Suite 4, Test 4.12 | HTTP 200 handled gracefully | **PASSED** |

### 8.1 Integration Suite Outcomes

| Suite | Command | Result |
| :--- | :--- | :--- |
| Phase 1 Security Regression Suite | `npm run test:security` | **81/81 PASSED** (Exit 0) |
| Automatic Service Discovery Test | `npm run test:discovery` | **PASSED** (Exit 0) |
| Circuit Breaker Unit Test | `npm run test:circuit-unit` | **PASSED** (Exit 0) |
| Circuit Breaker Live Integration | `npm run test:circuit` | **PASSED** (Exit 0) |
| Redis Distributed Lock Unit & Integration | `npm run test:lock` | **24/24 PASSED** (Exit 0) |
| Git Formatting & Whitespace Check | `git diff --check` | **CLEAN** (Exit 0) |

---

## 9. Summary of Files Changed

| File Path | Description of Audit Modification |
| :--- | :--- |
| `docker-compose.yml` | Replaced hardcoded literal credentials with `${JWT_SECRET}` and `${REFRESH_TOKEN_SECRET}` interpolations; added `${SERVICE_REGISTRY_TOKEN}` to all services. |
| `api-gateway/src/registry/registryValidation.ts` | Added `DEFAULT_DISALLOWED_PORTS` (22, 6379, 8000, 27017, etc.), service-specific port allowlists/ranges, and authorized destination host validation (`DEFAULT_ALLOWED_HOSTS`). |
| `api-gateway/src/registry/registrySecurity.ts` | Removed fallback to `JWT_SECRET`; requires dedicated `SERVICE_REGISTRY_TOKEN`. Implemented SHA-256 digest comparison for safe constant-time evaluation. |
| `api-gateway/src/config/jwtConfig.ts` | Implemented multi-tier validation policy (missing check, 32-char threshold, placeholder blacklist, character diversity, production guard) with explicit entropy disclosure. |
| `api-gateway/src/authentication/JWTAuthentication.ts` | Explicitly restricted verification algorithm to `['HS256']`. Added type and presence assertions for `sub` and `role` claims. |
| `user-service/src/config/jwtConfig.ts` | Added multi-tier validation policy matching Gateway. |
| `user-service/src/services/authService.ts` | Explicitly specified `algorithm: 'HS256'` during JWT token creation. |
| `product-service/src/registry/registerService.ts` | Strictly requires `SERVICE_REGISTRY_TOKEN` without `JWT_SECRET` fallback; added `\| undefined` for exact optional property type safety. |
| `user-service/src/registry/registerService.ts` | Strictly requires `SERVICE_REGISTRY_TOKEN` without `JWT_SECRET` fallback; added `\| undefined` for exact optional property type safety. |
| `order-service/src/registry/registerService.ts` | Strictly requires `SERVICE_REGISTRY_TOKEN` without `JWT_SECRET` fallback; added `\| undefined` for exact optional property type safety. |
| `product-service/src/models/ReconciliationTask.ts` | Added `\| undefined` on optional interface properties to satisfy `exactOptionalPropertyTypes`. |
| `user-service/src/discovery/registerClient.ts` | Re-exports from `../registry/registerService` to eliminate unauthenticated legacy client divergence. |
| `product-service/src/discovery/registerClient.ts` | Re-exports from `../registry/registerService`. |
| `order-service/src/discovery/registerClient.ts` | Re-exports from `../registry/registerService`. |
| `.env.example` | Updated examples and comments to document required 32+ character secrets for both `JWT_SECRET` and `SERVICE_REGISTRY_TOKEN`. |
| `test/service-discovery-test.js` | Updated to require dedicated `SERVICE_REGISTRY_TOKEN` without `JWT_SECRET` fallback. |
| `test/phase1-security-test.js` | Expanded to 81 automated assertions covering port blocking, service port ranges, host allowlists, algorithm restriction, claim assertions, route aliases, and credential independence. |
