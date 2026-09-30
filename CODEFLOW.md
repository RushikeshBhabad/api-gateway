# Comprehensive Codebase & Architecture Codeflow Guide

This document provides an exhaustive, step-by-step walkthrough of the **Microservice Book Store with Extensible API Gateway**, detailing the system design, request lifecycles, authentication, authorization, data models, inter-service communication, and frontend integration.

---

## 1. System Architecture & Component Overview

```
                          +-----------------------+
                          |   React + Vite UI     |
                          | (http://localhost:5173)|
                          +-----------+-----------+
                                      |
                                      | HTTP REST (Cookies / Bearer Token)
                                      v
                          +-----------------------+
                          |      API Gateway      |
                          | (http://localhost:8000)|
                          +---+-------+-------+---+
                              |       |       |
            +-----------------+       |       +-----------------+
            |                         |                         |
            v                         v                         v
+-----------------------+ +-----------------------+ +-----------------------+
|     User Service      | |    Product Service    | |     Order Service     |
| (http://localhost:3001)| | (http://localhost:3002)| | (http://localhost:3003)|
+-----------+-----------+ +-----------+-----------+ +-----------+-----------+
            |                         |                         |
            |                         +------------<------------+ (Internal REST:
            |                                                      Stock Reservation)
            v                                                   v
+---------------------------------------------------------------------------+
|                          MongoDB Database Cluster                         |
|   - Database: bookstore                                                   |
|   - Collections: users, refreshtokens, products, orders                  |
+---------------------------------------------------------------------------+
```

---

## 2. API Gateway: Extensibility & Strategy Pattern

The API Gateway is the single point of entry. It implements the **Strategy Pattern** to decouple routing from security and governance concerns.

### 2.1 Authentication Strategy (`AuthenticationStrategy`)
- **Interface**: `AuthenticationStrategy` with `authenticate(req: Request): Promise<AuthenticationContext | null>`
- **Implementation**: `JWTAuthentication`
  1. Extracts the `Authorization: Bearer <token>` header.
  2. Verifies signature using `JWT_SECRET` with `jsonwebtoken`.
  3. Returns `AuthenticationContext` (`{ userId, role }`) or `null` if invalid/missing.

### 2.2 Authorization Strategy (`AuthorizationStrategy`)
- **Interface**: `AuthorizationStrategy` with `authorize(role: string, method: string, path: string): boolean`
- **Implementation**: `RBACAuthorization`
  - `ADMIN`: Granted full access to all endpoints (product creation, updates, deletion, etc.).
  - `USER`:
    - Permitted: `GET /products`, `GET /products/:id`, `GET /users/me`, `PUT /users/me`, `POST /orders`, `GET /orders`, `GET /orders/:id`, `POST /auth/logout`.
    - Restricted (403 Forbidden): `POST /products`, `PUT /products/:id`, `DELETE /products/:id`.

### 2.3 Future Strategy Extensions (Plug-and-Play)
- **Rate Limiting**: Prepared `RateLimiter` interface for Token Bucket, Sliding Window, and Redis-backed rate limiting.
- **Load Balancing**: Prepared `LoadBalancer` interface for Round Robin, Least Connections, and IP Hash.

### 2.4 Correlation & Observability (`X-Request-ID`)
1. Gateway intercepts every inbound request.
2. Generates a UUIDv4 if `X-Request-ID` is missing.
3. Sets `X-Request-ID` on response headers and downstream proxy request headers for distributed tracing.

---

## 3. End-to-End Detailed Codeflows

### 3.1 Local Authentication Codeflow (Signup & Login)

```
Client                     API Gateway                 User Service               MongoDB
  |                             |                            |                       |
  |-- POST /api/auth/signup --->|                            |                       |
  |   { name, email, password } |                            |                       |
  |                             |-- Proxy -> /auth/signup -->|                       |
  |                             |                            |-- Check email exists ->|
  |                             |                            |<-- User not found ----|
  |                             |                            |-- Hash pass (Argon2)->|
  |                             |                            |-- Save User Doc ----->|
  |                             |<-- 201 Created (User) -----|<-- Saved User --------|
  |<-- 201 Created -------------|                            |                       |
  |                             |                            |                       |
  |-- POST /api/auth/login ---->|                            |                       |
  |   { email, password }       |                            |                       |
  |                             |-- Proxy -> /auth/login --->|                       |
  |                             |                            |-- Find user by email ->|
  |                             |                            |<-- User doc ----------|
  |                             |                            |-- Verify Argon2 hash -|
  |                             |                            |-- Gen Access JWT (2h)-|
  |                             |                            |-- Gen Refresh Token --|
  |                             |                            |-- Hash Refresh Token -|
  |                             |                            |-- Save RefreshToken ->|
  |                             |<-- 200 OK + Set Cookie ----|<-- Record saved ------|
  |<-- 200 OK (JWT + Cookie) ---|                            |                       |
```

1. **Signup (`POST /api/auth/signup`)**:
   - `authController.signup()` verifies payload completeness.
   - `authService.signup()` queries `User.findOne({ email })`.
   - Hashes password using `argon2.hash(password)`.
   - Instantiates `User` with role `USER` (`ADMIN` cannot be registered through public signup).
2. **Login (`POST /api/auth/login`)**:
   - `authService.login()` verifies password via `argon2.verify(user.passwordHash, password)`.
   - Issues short-lived Access JWT (2 hours) signed with `JWT_SECRET`.
   - Generates cryptographically secure 32-byte opaque Refresh Token.
   - Computes SHA-256 hash of Refresh Token and stores `{ userId, tokenHash, expiresAt: 7 days }` in MongoDB.
   - Sets secure `HttpOnly` cookie for the refresh token and returns access token in JSON body.

---

### 3.2 Token Refresh & Rotation Flow

```
Client (Axios Interceptor)      API Gateway                 User Service               MongoDB
  |                                  |                            |                       |
  |-- (Request returns 401) -------->|                            |                       |
  |-- POST /api/auth/refresh ------->|                            |                       |
  |   (Cookie: refreshToken=...)     |                            |                       |
  |                                  |-- Proxy -> /auth/refresh ->|                       |
  |                                  |                            |-- SHA256(token) ----->|
  |                                  |                            |-- Find RefreshToken ->|
  |                                  |                            |<-- Token Record ------|
  |                                  |                            |-- Verify not revoked -|
  |                                  |                            |-- Verify not expired -|
  |                                  |                            |-- Revoke Old Token -->|
  |                                  |                            |-- Gen New Pair ------>|
  |                                  |                            |-- Save New Token Hash>|
  |                                  |<-- 200 OK (New Tokens) ----|<-- Saved -------------|
  |<-- 200 OK (New Tokens) ----------|                            |                       |
  |-- Retry original request ------->|                            |                       |
```

- If an already revoked token is used, access is denied (defense against token reuse attacks).
- Rotation ensures single-use lifecycle for refresh tokens.

---

### 3.3 Google OAuth 2.0 Integration Codeflow

```
Client (Browser)         API Gateway           User Service           Google Auth Server
  |                           |                     |                          |
  |-- GET /api/auth/google -->|                     |                          |
  |                           |-- Proxy ----------->|                          |
  |                           |<-- 302 Redirect ----|-- Redirect to Google --->|
  |<-- 302 Redirect to Google-|                     |                          |
  |                                                                            |
  |-- (User logs in on Google & grants consent) ------------------------------>|
  |                                                                            |
  |-- GET /api/auth/google/callback?code=... --------------------------------->|
  |                           |                     |                          |
  |                           |-- Proxy ----------->|                          |
  |                           |                     |-- Exchange code for user>|
  |                           |                     |<-- User profile info ----|
  |                           |                     |-- Find or Create User ---|
  |                           |                     |   (authProvider='GOOGLE')|
  |                           |                     |-- Issue App JWT + Refresh|
  |                           |<-- 302 to Frontend -|                          |
  |<-- Redirect to /?accessToken=... ---------------|                          |
```

- Google OAuth authenticates identity; our backend creates the internal session and returns our standard application JWT & Refresh Token.
- Supports both `LOCAL` and `GOOGLE` auth providers seamlessly in the `User` model.

---

### 3.4 Protected Route & Role-Based Authorization Codeflow

```
Client                     API Gateway                   Target Service (Product/User/Order)
  |                             |                                      |
  |-- Request + Bearer Token -->|                                      |
  |                             |-- authMiddleware()                   |
  |                             |   1. JWTAuthentication.authenticate()|
  |                             |      -> Decodes sub, role            |
  |                             |   2. RBACAuthorization.authorize()   |
  |                             |      -> Checks method + route + role |
  |                             |                                      |
  |                             |-- If Forbidden (e.g. USER on POST)   |
  |<- 403 Forbidden Response ---|                                      |
  |                             |-- If Authorized:                     |
  |                             |   Injects:                           |
  |                             |     X-User-Id: <id>                  |
  |                             |     X-User-Role: <role>              |
  |                             |     X-Request-ID: <uuid>             |
  |                             |-- Proxies request ------------------>|
  |                             |                                      |-- Executes controller
  |                             |<-- Response -------------------------|<-- Returns data
  |<-- 200 OK ------------------|                                      |
```

---

### 3.5 Order Placement & Atomic Stock Reservation Codeflow

```
Client                   API Gateway              Order Service             Product Service
  |                           |                         |                          |
  |-- POST /api/orders ------>|                         |                          |
  |   { items: [{ id, qty }] }|-- Passes X-User-Id ---->|                          |
  |                           |                         |-- GET /products/:id ---->|
  |                           |                         |<-- 200 OK (Product Info)-|
  |                           |                         |                          |
  |                           |                         |-- PUT /:id/reserve ----->|
  |                           |                         |   { quantity: 2 }        |
  |                           |                         |                          |-- Atomic Update:
  |                           |                         |                          |   findOneAndUpdate(
  |                           |                         |                          |     { _id, stock: {$gte: qty} },
  |                           |                         |                          |     { $inc: { stock: -qty } }
  |                           |                         |                          |   )
  |                           |                         |<-- 200 OK (Updated Doc)--|
  |                           |                         |                          |
  |                           |                         |-- Save Order in DB       |
  |                           |<-- 201 Created (Order) -|                          |
  |<-- 201 Created (Order) ---|                         |                          |
```

- **Concurrency Protection**: Product reservation uses atomic `$gte` and `$inc` operators in MongoDB so two concurrent requests cannot oversell items.
- **Microservice Isolation**: Order Service does not access Product database directly; it communicates over internal HTTP endpoints.

---

## 4. Database Schema Specifications

### 4.1 `User` Model (`user-service/src/models/User.ts`)
| Field | Type | Description |
|---|---|---|
| `_id` | `ObjectId` | Unique user identifier |
| `name` | `String` | Full name |
| `email` | `String` | Unique index, user email |
| `passwordHash` | `String` | Argon2 hash (required if `authProvider == 'LOCAL'`) |
| `role` | `String` | `'USER'` or `'ADMIN'` (default: `'USER'`) |
| `authProvider` | `String` | `'LOCAL'` or `'GOOGLE'` (default: `'LOCAL'`) |
| `providerUserId`| `String` | Google Profile ID if OAuth |
| `createdAt` / `updatedAt` | `Date` | Timestamp records |

### 4.2 `RefreshToken` Model (`user-service/src/models/RefreshToken.ts`)
| Field | Type | Description |
|---|---|---|
| `_id` | `ObjectId` | Session token identifier |
| `userId` | `ObjectId` | References `User` document |
| `tokenHash` | `String` | SHA-256 digest of the opaque token |
| `expiresAt` | `Date` | 7-day expiration date |
| `revokedAt` | `Date` | Null if active, Date when revoked/rotated |

### 4.3 `Product` Model (`product-service/src/models/Product.ts`)
| Field | Type | Description |
|---|---|---|
| `_id` | `ObjectId` | Unique product identifier |
| `title` | `String` | Book title (Text Indexed) |
| `author` | `String` | Book author (Text Indexed) |
| `category` | `String` | Category / genre (Text Indexed) |
| `price` | `Number` | Item price |
| `stock` | `Number` | In-stock quantity (atomically decremented) |
| `description` | `String` | Book summary |
| `image` | `String` | Cover image URL |

### 4.4 `Order` Model (`order-service/src/models/Order.ts`)
| Field | Type | Description |
|---|---|---|
| `_id` | `ObjectId` | Unique order identifier |
| `userId` | `String` | ID of user who placed order |
| `items` | `Array` | Array of `{ productId, quantity, price }` |
| `totalAmount` | `Number` | Computed total order price |
| `status` | `String` | `'PENDING'`, `'COMPLETED'`, `'CANCELLED'` |

---

## 5. Frontend Integration Architecture

- **AuthContext (`frontend/src/contexts/AuthContext.tsx`)**:
  - Maintains `user` state and `accessToken` in memory and `localStorage`.
  - Exposes `login()` and `logout()` helpers.
- **Pages**:
  - `Home`: Displays landing page, navigation, and user authentication state.
  - `Login` & `Signup`: Responsive credential submission and state synchronization.
  - `Products`: Connects to `GET /api/products` via the API Gateway to render catalog.

---

## 6. How to Run and Test

```bash
# 1. Start all services:
# API Gateway
cd api-gateway && npm start

# User Service
cd user-service && npm start

# Product Service
cd product-service && npm start

# Order Service
cd order-service && npm start

# Frontend UI
cd frontend && npm run dev
```
