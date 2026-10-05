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

### Docker Compose

1. Run `docker compose up --build`.

## Advanced Features

* **Load Balancer**: Supports multiple dynamic routing strategies:
  * `ROUND_ROBIN`, `WEIGHTED_ROUND_ROBIN`, `LEAST_CONNECTIONS`, `RANDOM`, `CONSISTENT_HASHING`.
* **Circuit Breaker**: Resilient routing that trips (opens) on repeated failures and supports a `HALF_OPEN` state for recovery testing.
* **Rate Limiting**: Configurable rate limits.

## Testing Resiliency

You can run automated tests for Load Balancing and Circuit Breakers:
```bash
npm run test:lb
npm run test:circuit
npm run test:concurrent
```

## Future Extensions

The API Gateway is designed with Strategy Patterns in `api-gateway/src/strategies` and `api-gateway/src/loadbalance`. Currently implemented: Authentication, Authorization, Load Balancing, and Circuit Breaking.
