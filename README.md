# Microservice Book Store with Extensible API Gateway

This is a microservice-based Book Store application built with Node.js, Express, React, and MongoDB. 

## Services

* **API Gateway** (Port 8000): Central entry point. Implements reverse proxy and Strategy Pattern for Authentication (JWT) and Authorization (RBAC).
* **User Service** (Port 3001): Manages users, auth, JWT and Refresh Tokens.
* **Product Service** (Port 3002): Manages books/products.
* **Order Service** (Port 3003): Manages user orders and communicates with Product Service for stock reservation.
* **Frontend** (Port 5173): React + Vite application.

## How to Run

### Local Native (Without Docker)

1. Create a `.env` in the root folder with `MONGODB_URI`, `JWT_SECRET`, and `REFRESH_TOKEN_SECRET`.
2. Install dependencies and start each service:
   ```bash
   cd api-gateway && npm install && npm start
   cd ../user-service && npm install && npm start
   cd ../product-service && npm install && npm start
   cd ../order-service && npm install && npm start
   cd ../frontend && npm install && npm run dev
   ```

### Redis Distributed Locking & Testing

Redis distributed locking protects high-concurrency product stock reservation and prevents overselling.
Detailed documentation is available in [REDIS_DISTRIBUTED_LOCK.md](./REDIS_DISTRIBUTED_LOCK.md).

#### Running Lock Tests
```bash
# Unit tests (lock acquisition, mutual exclusion, lease expiry, stale protection, 503 on failure)
npm run test:lock-unit

# Concurrency integration tests (Multi-process Order/Product services, race conditions, compensation)
npm run test:lock-integration

# All lock tests
npm run test:lock
```

### Docker Compose

1. Run `docker compose up --build`.

## Future Extensions

The API Gateway is designed with Strategy Patterns in `api-gateway/src/strategies`. Currently, Authentication, Authorization, Load Balancing (5 strategies), Service Discovery, Circuit Breakers, and Redis Distributed Locking are implemented.
