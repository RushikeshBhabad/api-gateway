# Project: Microservice Book Store with Extensible API Gateway

I want you to build a **fully working microservice-based Book Store application** using the MERN/Node.js ecosystem.

The most important part of this project is the **API Gateway architecture**, because later I will extend the gateway with multiple interchangeable algorithms for:

* Authentication
* Authorization
* Rate limiting
* Load balancing
* Health checking
* Circuit breaking
* Other gateway-level capabilities

However, **do NOT implement load balancing and rate limiting yet**. For the current phase, implement the complete microservice foundation and implement **Authentication + Authorization properly**.

The architecture must be designed so that these future features can be plugged in without rewriting the existing gateway.

---

# 1. Main Objective

Build a small but realistic **microservice-based online Book Store**.

Architecture:

```text
                    React Frontend
                          |
                          v
                  +---------------+
                  |  API GATEWAY  |
                  |    :8000      |
                  +-------+-------+
                          |
             +------------+------------+
             |            |            |
             v            v            v
       +----------+ +----------+ +----------+
       |   User   | | Product  | |  Order   |
       | Service  | | Service  | | Service  |
       |  :3001   | |  :3002   | |  :3003   |
       +----+-----+ +----+-----+ +----+-----+
            |            |            |
            v            v            v
         MongoDB      MongoDB      MongoDB

                    +---------+
                    |  Redis  |
                    +---------+
```

The frontend should communicate with the backend **only through the API Gateway**.

The frontend must NOT directly call User Service, Product Service, or Order Service.

---

# 2. Services

Create these components:

```text
frontend/
api-gateway/
user-service/
product-service/
order-service/
```

The three backend services are:

1. User Service
2. Product Service
3. Order Service

The API Gateway is the only public backend entry point.

---

# 3. Technology Stack

Use:

### Frontend

* React
* Vite
* React Router
* Axios
* Clean component architecture
* Responsive UI

### Backend

* Node.js
* Express.js
* Prefer TypeScript if practical
* REST APIs

### Database

* MongoDB
* Mongoose

### Cache / shared infrastructure

* Redis
* Use Redis where it genuinely makes sense
* Do not artificially add Redis everywhere

### Authentication

* JWT
* Refresh tokens
* Secure password hashing
* Proper salt mechanism

### Infrastructure

* Docker
* Docker Compose

Use environment variables for all configuration.

Never hardcode:

* MongoDB URLs
* JWT secrets
* Redis URLs
* passwords
* API secrets

---

# 4. Important Architectural Principle

The API Gateway must be designed using a **Strategy Pattern / interface-based architecture**.

Even though we are currently implementing only authentication and authorization, the architecture must make it easy to later add:

```text
Authentication:
    JWT
    API Key
    OAuth

Authorization:
    RBAC
    ABAC

Rate Limiting:
    Fixed Window
    Sliding Window
    Sliding Window Counter
    Token Bucket
    Leaky Bucket

Load Balancing:
    Round Robin
    Weighted Round Robin
    Random
    Least Connections
    IP Hash
```

Do NOT write the gateway as a giant collection of:

```javascript
if (algorithm === ...)
else if (...)
else if (...)
```

Instead, create interfaces/strategies such as:

```text
AuthenticationStrategy
AuthorizationStrategy
RateLimiter
LoadBalancer
```

For now:

```text
AuthenticationStrategy -> JWTAuthentication
AuthorizationStrategy  -> RBAC
```

Later strategies should be addable without modifying the gateway core.

---

# 5. Authentication

Implement real authentication.

The system must support:

```text
Signup
Login
Logout
Access Token
Refresh Token
Token Refresh
Token Revocation
```

---

# 6. Signup

Endpoint:

```http
POST /api/auth/signup
```

Example:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

Signup must:

1. Validate input.
2. Check whether email already exists.
3. Hash the password securely.
4. Use a proper salt mechanism.
5. Never store plaintext passwords.
6. Create a user with default role:

```text
USER
```

Admin users must NOT be created by normal public signup.

---

# 7. Password Security

Use a proper password hashing algorithm such as:

```text
Argon2id
```

or bcrypt if Argon2 is not practical.

Prefer Argon2id.

Passwords must never be:

* stored directly
* logged
* returned in API responses
* returned to frontend

Use the hashing library's proper salt mechanism.

Do not implement custom cryptographic hashing.

---

# 8. Roles

There are exactly two roles for now:

```text
USER
ADMIN
```

Normal signup always creates:

```text
role = USER
```

Admin accounts should be seeded manually or created through a controlled mechanism.

Do NOT allow:

```json
{
  "role": "ADMIN"
}
```

during public signup.

---

# 9. Login

Endpoint:

```http
POST /api/auth/login
```

Request:

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

The system should:

1. Find the user.
2. Verify the password.
3. Generate an access JWT.
4. Generate a refresh token.
5. Store the refresh-token information securely in MongoDB.
6. Return the appropriate authentication response.
7. Never return password information.

---

# 10. JWT Access Token

The access JWT should have:

```text
Expiration = 2 hours
```

Keep the JWT lightweight.

Do not put unnecessary information inside it.

Suggested payload:

```json
{
  "sub": "user-id",
  "role": "USER",
  "iat": "...",
  "exp": "..."
}
```

Do not store:

* password
* email unless genuinely required
* large permission arrays
* sensitive user information

The gateway should verify:

* signature
* expiration
* token structure
* required claims

---

# 11. Refresh Token

Refresh token lifetime:

```text
1 week
```

The refresh token should be securely generated using a cryptographically secure random generator.

Do NOT use a predictable JWT-like refresh token unless there is a strong architectural reason.

Prefer an opaque random refresh token.

Store a **hash of the refresh token** in MongoDB rather than storing the raw refresh token.

Suggested database structure:

```text
RefreshToken
-------------
userId
tokenHash
expiresAt
createdAt
revokedAt
```

The raw refresh token should only be returned to the client.

---

# 12. Refresh Token Rotation

Implement proper refresh-token rotation.

When:

```http
POST /api/auth/refresh
```

is called:

1. Validate the refresh token.
2. Find its hash in MongoDB.
3. Check expiration.
4. Check whether it has been revoked.
5. Revoke the old refresh token.
6. Generate a new refresh token.
7. Generate a new access JWT.
8. Store the new refresh-token hash.

This should prevent indefinite reuse of the same refresh token.

If an already-revoked refresh token is reused, treat it as suspicious token reuse and invalidate the relevant refresh-token/session chain where practical.

---

# 13. Logout

Implement:

```http
POST /api/auth/logout
```

The refresh token/session should be revoked.

Remember:

JWT access tokens are stateless, so logout should primarily invalidate the refresh-token session.

If a design requires immediate access-token revocation, explain the tradeoff and use Redis or another mechanism rather than pretending a normal JWT can be magically deleted.

---

# 14. Authentication Architecture

The flow should be:

```text
                    Client
                      |
                      v
                API Gateway
                      |
               JWT Authentication
                      |
             +--------+--------+
             |                 |
           Invalid           Valid
             |                 |
            401                v
                         Authorization
                              |
                              v
                         Target Service
```

Authentication logic should be reusable and isolated.

Example conceptual structure:

```text
api-gateway/
  src/
    authentication/
      AuthenticationStrategy.ts
      JWTAuthentication.ts
      AuthenticationContext.ts
```

The gateway should not contain authentication logic directly inside route handlers.

---

# 15. Authorization

For this phase use:

```text
RBAC
```

with:

```text
USER
ADMIN
```

Create an authorization strategy/interface so ABAC can be added later.

Conceptually:

```text
AuthorizationStrategy
        |
        +---- RBACAuthorization
        |
        +---- ABACAuthorization 
        both implement 
```

---

# 16. Authorization Rules

### USER

A normal user can:

```text
View own profile
Update own profile

Search books
View book details

Create orders
View own orders
```

### ADMIN

Admin can additionally:

```text
Add books
Update books
Delete books
Update stock
View appropriate management information
```

Normal users must NOT be able to:

```text
POST /api/books
PUT /api/books/:id
DELETE /api/books/:id
```

---

# 17. User Service

The User Service owns user-related data and authentication-related business logic.

Suggested endpoints:

```text
POST   /auth/signup
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /users/me
PUT    /users/me

GET    /health
```

The gateway should expose these through:

```text
/api/auth/*
/api/users/*
```

The frontend must call the gateway, not the User Service directly.

---

# 18. User Profile

After login, the user should be able to see:

```text
Name
Email
Role
Account creation date
```

The user should be able to update appropriate profile information.

Do not allow users to arbitrarily change:

```text
role
userId
password hash
```

If password change is implemented, create a dedicated endpoint:

```text
PUT /api/users/me/password
```

and require the current password or another secure verification mechanism.

---

# 19. Product / Book Service

Call the domain either:

```text
Product Service
```

with books as the product type, or:

```text
Book Service
```

Either is acceptable, but keep naming consistent.

A product/book should contain something similar to:

```json
{
  "_id": "...",
  "title": "Clean Code",
  "author": "Robert C. Martin",
  "category": "Programming",
  "price": 500,
  "stock": 20,
  "description": "...",
  "image": "...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Do not overcomplicate the schema.

---

# 20. Product APIs

Users:

```text
GET /api/products
GET /api/products/:id
GET /api/products/search
```

Support useful search/filtering such as:

```text
Search by title
Search by author
Search by category
Filter by price
```

Examples:

```text
GET /api/products?search=clean
GET /api/products?category=Programming
GET /api/products?author=Martin
GET /api/products/:id
```

Add pagination.

For example:

```text
?page=1&limit=10
```

Do not load thousands of products at once.

---

# 21. Admin Product Management

Only ADMIN can:

```text
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id
```

Admin should be able to:

```text
Add product
Edit product
Delete product
Change stock
```

Seed the database with several dummy books/products.

Create at least 10 useful dummy products so that:

* search can be tested
* categories can be tested
* pagination can be tested
* product listing can be demonstrated
* orders can be tested

---

# 22. Order Service

Users should be able to purchase/book products.

Endpoints:

```text
POST /api/orders
GET  /api/orders
GET  /api/orders/:id
```

A user should only be able to see their own orders.

ADMIN can later have broader order visibility if needed.

---

# 23. Order Creation

Example:

```http
POST /api/orders
```

```json
{
  "items": [
    {
      "productId": "123",
      "quantity": 2
    }
  ]
}
```

Order flow:

```text
Client
   |
   v
Gateway
   |
   v
Order Service
   |
   +----> Product Service
   |          |
   |          +--> Check product
   |          +--> Check stock
   |
   +----> Create Order
   |
   +----> Reduce stock
```

The final design should be safe against two users purchasing the last available item simultaneously.

Do not simply:

```text
read stock
stock--
save stock
```

without considering concurrency.

Use an atomic MongoDB operation or another appropriate mechanism.

For example, conceptually:

```text
UPDATE product
WHERE _id = X AND stock >= requestedQuantity

stock = stock - requestedQuantity
```

Only proceed with the order if the stock update succeeds.

Explain the consistency tradeoffs in the implementation.

---

# 24. Important Microservice Rule

Do not make the services tightly coupled.

Each service should own its own data.

Conceptually:

```text
User Service
    |
    +---- User DB

Product Service
    |
    +---- Product DB

Order Service
    |
    +---- Order DB
```

The services communicate using APIs.

Do not allow Order Service to directly access Product Service's MongoDB collections.

---

# 25. API Gateway

The API Gateway is the central focus of the project.

Initially implement:

```text
Routing
Reverse proxy
Authentication
Authorization
Request ID
Logging
Error handling
```

Do NOT implement:

```text
Load balancing
Rate limiting
Circuit breaker
Advanced service discovery
```

yet.

But design the architecture so they can be added later.

---

# 26. Gateway Routing

Example:

```text
/api/auth/*       -> User Service
/api/users/*      -> User Service

/api/products/*   -> Product Service

/api/orders/*     -> Order Service
```

The frontend should only communicate with:

```text
http://localhost:8000
```

---

# 27. Future Load Balancer Architecture

Do not implement it now, but prepare the abstraction.

For example:

```typescript
interface LoadBalancer {
    selectServer(
        servers: ServerInstance[],
        requestContext: RequestContext
    ): ServerInstance;
}
```

Later I want to implement:

```text
Round Robin
Weighted Round Robin
Random
Least Connections
IP Hash
```

The gateway should eventually be able to select one using configuration:

```text
LOAD_BALANCER=ROUND_ROBIN
```

or:

```text
LOAD_BALANCER=LEAST_CONNECTIONS
```

without changing the gateway's core routing logic.

---

# 28. Future Rate Limiter Architecture

Again, do NOT implement now.

Prepare:

```typescript
interface RateLimiter {
    allow(context: RateLimitContext): Promise<boolean>;
}
```

Later:

```text
Fixed Window
Sliding Window
Sliding Window Counter
Token Bucket
Leaky Bucket
```

Configuration should eventually allow:

```text
RATE_LIMITER=TOKEN_BUCKET
```

without rewriting the gateway.

---

# 29. Redis

Use Redis where appropriate.

For the current implementation, Redis can be used for:

* temporary/session-related state if appropriate
* future distributed rate limiting
* caching
* token/session revocation if needed
* future gateway shared state

Do not force every operation through Redis.

MongoDB remains the source of truth for persistent application data.

---

# 30. Frontend

Create a simple but functional React frontend.

Pages:

```text
Home
Login
Signup
Profile
Products
Product Details
Orders
Admin Dashboard
Add Product
Edit Product
```

---

# 31. Home Page

The home page should demonstrate that everything is connected.

Show:

```text
Navigation
User login state
Featured products
Product search
Categories
Product cards
```

If logged in:

```text
Profile
Orders
Logout
```

If ADMIN:

```text
Admin Dashboard
Add Product
Manage Products
```

If USER:

```text
My Profile
My Orders
```

---

# 32. Login UX

After successful login:

* store authentication state securely
* update navbar
* show user's name
* show role
* redirect appropriately
* display useful errors on failed login

For browser token storage, choose a security-conscious approach.

Prefer an architecture where refresh tokens are stored in secure, HttpOnly cookies if practical, rather than exposing long-lived refresh tokens to JavaScript.

Explain the chosen approach.

---

# 33. API Error Format

Create a consistent error response.

Example:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired access token"
  },
  "requestId": "..."
}
```

Use appropriate HTTP status codes:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
429 Too Many Requests (future rate limiter)
500 Internal Server Error
503 Service Unavailable
```

---

# 34. Request ID / Correlation ID

Every request entering the gateway should receive a unique:

```text
X-Request-ID
```

The ID should be forwarded to downstream services.

Example:

```text
Client
  |
  | X-Request-ID: abc123
  v
Gateway
  |
  | X-Request-ID: abc123
  v
User Service
```

Logs from all services should contain the request ID.

This will become very useful when we later implement distributed-system observability.

---

# 35. Logging

Use structured logging.

Every request should be able to produce something like:

```json
{
  "requestId": "abc123",
  "method": "GET",
  "path": "/api/products",
  "userId": "user123",
  "role": "USER",
  "statusCode": 200,
  "latencyMs": 35
}
```

Never log:

```text
password
JWT secret
refresh token
raw API credentials
```

---

# 36. Security Requirements

Implement:

* CORS correctly
* Helmet
* Input validation
* Request body limits
* Secure password hashing
* JWT signature verification
* Refresh-token hashing
* Refresh-token rotation
* Token expiration
* Role-based authorization
* No sensitive information in logs
* No secrets committed to Git
* Environment variables
* Proper HTTP status codes

Also protect sensitive authentication endpoints against obvious abuse even though the full rate limiter is a future task.

---

# 37. Database Indexes

Create appropriate indexes.

At minimum consider:

```text
User:
email unique index

Product:
title
category
author

RefreshToken:
tokenHash
userId
expiresAt

Order:
userId
createdAt
```

Do not create unnecessary indexes.

---

# 38. Docker Compose

Create a Docker Compose setup containing:

```text
frontend
api-gateway
user-service
product-service
order-service
mongodb
redis
```

Make the application runnable with a simple command such as:

```bash
docker compose up --build
```

Use service names for internal communication rather than hardcoded localhost where appropriate.

For example:

```text
http://user-service:3001
http://product-service:3002
http://order-service:3003
```

---

# 39. Seed Data

Create:

### Admin

A seeded admin account.

Document the credentials safely in development documentation or environment configuration rather than hardcoding them into application logic.

### Users

Create a few sample users.

### Products

Create at least 10 dummy books.

Example categories:

```text
Programming
Database
Algorithms
System Design
AI/ML
Computer Networks
Operating Systems
```

---

# 40. Testing

Add tests for the most important flows.

At minimum:

### Authentication

```text
Signup success
Duplicate email
Invalid password
Login success
Login failure
JWT expiration
Refresh token
Refresh token rotation
Logout
Revoked refresh token
```

### Authorization

```text
USER can read products
USER cannot add products
ADMIN can add products
ADMIN can update products
ADMIN can delete products
```

### Orders

```text
Create order
Insufficient stock
Stock decreases after order
User sees own orders
User cannot see another user's order
```

### Gateway

```text
Correct route forwarding
Invalid JWT blocked
Missing JWT blocked
RBAC enforcement
Request ID propagation
```

---

# 41. API Documentation

Create a clear README containing:

```text
Architecture
Services
Ports
Environment variables
How to run
Docker commands
API endpoints
Authentication flow
Authorization flow
Database structure
Redis usage
Testing
Future gateway algorithms
```

Also provide either:

```text
Swagger/OpenAPI
```

or a well-organized API documentation section.

---

# 42. Project Structure

Use a clean structure similar to:

```text
project/
│
├── frontend/
│
├── api-gateway/
│   └── src/
│       ├── authentication/
│       ├── authorization/
│       ├── middleware/
│       ├── proxy/
│       ├── routing/
│       ├── strategies/
│       ├── config/
│       └── server.ts
│
├── user-service/
│   └── src/
│       ├── controllers/
│       ├── services/
│       ├── models/
│       ├── routes/
│       ├── middleware/
│       └── server.ts
│
├── product-service/
│   └── src/
│       ├── controllers/
│       ├── services/
│       ├── models/
│       ├── routes/
│       └── server.ts
│
├── order-service/
│   └── src/
│       ├── controllers/
│       ├── services/
│       ├── models/
│       ├── routes/
│       └── server.ts
│
├── docker-compose.yml
├── .env.example
└── README.md
```

You can improve this structure if you have a better production-oriented organization.

---

# 43. Important: Do Not Overengineer the Current Phase

The purpose of the current implementation is to establish the foundation.

DO NOT currently implement:

```text
❌ Load balancing algorithms
❌ Rate limiting algorithms
❌ Complex service discovery
❌ Kafka
❌ RabbitMQ
❌ Kubernetes
❌ Distributed tracing infrastructure
❌ Complex payment system
❌ Complex recommendation system
```

Those can come later.

The current focus is:

```text
Microservices
+
Working Book Store
+
Authentication
+
Authorization
+
API Gateway
+
JWT
+
Refresh Tokens
+
RBAC
+
MongoDB
+
Redis foundation
+
Docker
```

---

# 44. Most Important Future Goal

The API Gateway is the primary engineering project.

Eventually I want to be able to configure:

```text
AUTHENTICATION = JWT

AUTHORIZATION = RBAC

RATE_LIMITER = TOKEN_BUCKET

LOAD_BALANCER = ROUND_ROBIN
```

and later change only the configuration:

```text
RATE_LIMITER = SLIDING_WINDOW

LOAD_BALANCER = LEAST_CONNECTIONS
```

without changing the core gateway.

The algorithms should be implemented behind interfaces/strategies.

The gateway should follow:

```text
Strategy Pattern
Factory Pattern
Middleware Pattern
Dependency Injection where appropriate
Configuration-driven behavior
```

---

# 45. Development Approach

Do not generate everything blindly in one huge step.

Implement in logical phases:

### Phase 1

Create:

```text
User Service
Product Service
Order Service
MongoDB
Redis
```

and make basic APIs work.

### Phase 2

Implement:

```text
Signup
Login
Password hashing
JWT
Refresh tokens
Logout
```

### Phase 3

Implement:

```text
API Gateway
Routing
Reverse proxy
JWT authentication middleware
RBAC authorization
```

### Phase 4

Connect React frontend.

### Phase 5

Add Docker Compose.

### Phase 6

Add tests and documentation.

At every phase, make sure the application remains runnable.

---

# 46. Final Acceptance Criteria

The implementation is considered successful when I can do the following:

```text
1. Start the complete application.

2. Open the React frontend.

3. Sign up as a normal USER.

4. Login successfully.

5. Receive/use a 2-hour JWT access token.

6. Receive a 1-week refresh token.

7. Refresh the access token.

8. Logout and revoke the refresh session.

9. View my profile.

10. Update my profile.

11. Browse products.

12. Search products.

13. Filter products by category/author/etc.

14. Create an order.

15. Product stock decreases correctly.

16. Cannot order more than available stock.

17. View my own orders.

18. Cannot access another user's private data.

19. Login as ADMIN.

20. ADMIN can add products.

21. ADMIN can update products.

22. ADMIN can delete products.

23. Normal USER cannot perform admin operations.

24. All frontend API requests go through the API Gateway.

25. Gateway rejects invalid/missing JWTs.

26. Gateway enforces RBAC.

27. Gateway propagates request IDs.

28. Services communicate correctly.

29. MongoDB persists data.

30. Redis is correctly integrated where appropriate.

31. Entire system can run through Docker Compose.
```

---

# 47. Before Coding

Before writing implementation code:

1. Show me the proposed architecture.
2. Show the service-to-service request flow.
3. Show the database schemas.
4. Show the authentication flow.
5. Show the refresh-token flow.
6. Show the authorization/RBAC flow.
7. Show the API Gateway folder structure.
8. Explain where Strategy Pattern will be used.
9. Explain how future load-balancing and rate-limiting strategies will plug in.
10. Then implement the system phase-by-phase.

Do not make major architectural assumptions silently.

If there are multiple reasonable choices, choose the simplest production-oriented solution and explain the decision briefly.

The final code should be **clean, modular, runnable, and interview/system-design friendly**, not just a quick prototype.

# 47. Authentication Refresh Flow and OAuth

Before coding, clearly design and document the complete authentication lifecycle.

## Access Token Refresh

The system uses:

```text
Access JWT     → 2 hours
Refresh Token  → 1 week
```

The `POST /api/auth/refresh` endpoint should be called when the current access JWT has expired or is about to expire while the refresh token is still valid.

The expected flow is:

```text
Login
  |
  +---- Access JWT (2 hours)
  |
  +---- Refresh Token (1 week)
              |
              v
        Access APIs normally
              |
              v
      Access JWT expires
              |
              v
   POST /api/auth/refresh
              |
       +------+------+
       |             |
   Valid refresh   Invalid/expired
       |             |
       v             v
New Access JWT     401
+ New Refresh
Token
```

Implement refresh-token rotation:

1. Receive the refresh token.
2. Validate it.
3. Hash it and find the corresponding database record.
4. Verify that it has not expired.
5. Verify that it has not been revoked.
6. Revoke the old refresh-token record.
7. Generate a new refresh token.
8. Store only the hash of the new refresh token.
9. Generate a new 2-hour JWT.
10. Return/use the new authentication credentials.

Prefer storing the refresh token in a **Secure, HttpOnly cookie** for the browser-based application.

The frontend should have an Axios interceptor or equivalent mechanism that:

1. Sends normal requests using the access JWT.
2. Detects an expired/invalid access token response.
3. Calls:

```http
POST /api/auth/refresh
```

4. Receives the new access token.
5. Retries the original request once.
6. If refresh fails, clear the authentication state and redirect the user to login.

Avoid infinite refresh/retry loops.

---

## OAuth Authentication

Also implement OAuth authentication, initially using **Google OAuth 2.0 / OpenID Connect**.

The authentication architecture should support:

```text
Local Authentication
        |
        +---- Email + Password
        |
        +---- Google OAuth
```

OAuth should integrate with the same user system.

Example flow:

```text
React
  |
  | Login with Google
  v
API Gateway
  |
  v
User Service
  |
  v
Google OAuth
  |
  v
Google Authorization
  |
  v
Callback
  |
  v
User Service
  |
  +---- Existing user?
  |         |
  |        YES
  |         |
  |         v
  |    Authenticate
  |
  +---- New user?
            |
            v
       Create USER
            |
            v
       Issue application
       access + refresh tokens
```

Important:

* Google OAuth is used to authenticate the user.
* The application should still issue its own application access JWT and refresh-token session after successful OAuth authentication.
* Do not treat Google's access token as the application's API authorization token.
* OAuth-created users should default to the `USER` role.
* Do not allow OAuth login to create an `ADMIN` account automatically.
* Existing accounts should be linked carefully using the verified provider identity/email according to the chosen account-linking policy.
* Store provider information such as:

```text
provider: "google"
providerUserId: "..."
```

where appropriate.

The user model should support both:

```text
LOCAL
GOOGLE
```

authentication methods without creating duplicate accounts unnecessarily.

Document:

1. Local signup/login flow.
2. Google OAuth flow.
3. JWT generation.
4. Refresh-token generation.
5. Access-token expiration.
6. Refresh-token rotation.
7. Logout/revocation.
8. OAuth account linking/creation.
9. How the gateway authenticates both local and OAuth users.
10. How both authentication methods eventually produce the same application-level authorization context:

```text
userId
role
authentication method
```

The final authentication architecture should allow future providers such as:

```text
Google
GitHub
Microsoft
Apple
```

to be added without rewriting the API Gateway's core authentication pipeline.
