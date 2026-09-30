# User Service Architecture & Codeflow Guide

This document explains the architecture of the `user-service` microservice, detailing each file's purpose, how authentication and authorization are handled, and where integration checks occur.

## Directory Structure
```
user-service/
├── src/
│   ├── config/
│   │   └── passport.ts
│   ├── controllers/
│   │   ├── authController.ts
│   │   └── userController.ts
│   ├── models/
│   │   ├── RefreshToken.ts
│   │   └── User.ts
│   ├── routes/
│   │   ├── authRoutes.ts
│   │   ├── oauthRoutes.ts
│   │   └── userRoutes.ts
│   ├── services/
│   │   └── authService.ts
│   └── server.ts
```

---

## 1. Entry Point
### `src/server.ts`
- **Purpose**: Initializes the Express server, connects to MongoDB, and registers all routers (`authRoutes`, `oauthRoutes`, `userRoutes`).
- **Integration**: It runs on port `3001` and is entirely shielded from the public internet. It only receives traffic proxied from the `api-gateway` (port `8000`).

---

## 2. Models (Database Schemas)
### `src/models/User.ts`
- **Purpose**: Mongoose schema defining the user object.
- **Fields**: `name`, `email`, `passwordHash`, `role` (`USER` or `ADMIN`), `authProvider` (`LOCAL` or `GOOGLE`), and `providerUserId`.
- **Integration**: Used extensively by the `authService` to find, verify, or register users.

### `src/models/RefreshToken.ts`
- **Purpose**: Mongoose schema for managing token rotation and active sessions.
- **Fields**: `userId`, `tokenHash` (SHA-256), `expiresAt`, `revokedAt`.
- **Security Check**: Stores only a cryptographically hashed version of the token. The raw token is only ever given once to the user (via HttpOnly cookies).

---

## 3. Services (Business Logic)
### `src/services/authService.ts`
- **Purpose**: Contains the core logic for cryptography, JWT signing, and database interactions.
- **Authentication Flow**:
  - `login()`: Fetches the `User` by email, verifies the password using `argon2.verify`, and if valid, calls `generateTokens()`.
  - `signup()`: Checks for email uniqueness, hashes the incoming password using `argon2.hash`, and creates the user with the specified `role` (either `USER` or `ADMIN`).
  - `refreshTokens()`: Takes a raw refresh token, hashes it with `sha-256`, looks it up in MongoDB, verifies it isn't expired or revoked, revokes the old one, and generates a new pair.
- **Token Generation (`generateTokens`)**: Uses `jsonwebtoken` to securely sign a JWT containing the `userId` (as `sub`) and the `role`. The API Gateway natively trusts this signature using the shared `JWT_SECRET`.

---

## 4. Controllers (HTTP Handlers)
### `src/controllers/authController.ts`
- **Purpose**: Extracts HTTP payload data (req.body/req.cookies) and delegates it to the `authService`.
- **Integration**: Sets the refresh token in an `HttpOnly` cookie via `res.cookie()`, ensuring XSS attacks cannot steal the session.

### `src/controllers/userController.ts`
- **Purpose**: Handles fetching and updating user profiles.
- **Authorization Call (Via Gateway Integration)**:
  - The Gateway's `authMiddleware` verifies the JWT. If valid, the Gateway appends `x-user-id` to the request headers and proxies it here.
  - `getMe()` / `updateMe()` simply reads `req.headers['x-user-id']` and queries the database. It implicitly trusts the Gateway's authentication.

---

## 5. Routes (Endpoints)
### `src/routes/authRoutes.ts`
- **Purpose**: Maps `POST /signup`, `POST /login`, `POST /refresh`, and `POST /logout` to `authController`.

### `src/routes/userRoutes.ts`
- **Purpose**: Maps `GET /me` and `PUT /me` to `userController`.

### `src/routes/oauthRoutes.ts` & `src/config/passport.ts`
- **Purpose**: Implements Google OAuth 2.0 Integration.
- **Authentication Flow**:
  1. `GET /auth/google` triggers Passport.js to redirect the user to Google's consent screen.
  2. `GET /auth/google/callback` receives the Google Profile data.
  3. `passport.ts` looks up the user by `providerUserId` or creates a new one with `authProvider: 'GOOGLE'`.
  4. The callback route generates internal application tokens via `authService.generateTokens()` and redirects the user back to the React frontend (`http://localhost:5173`) with the tokens securely attached.
