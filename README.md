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

## Future Extensions

The API Gateway is designed with Strategy Patterns in `api-gateway/src/strategies`. Currently, only Authentication and Authorization strategies are implemented, but interfaces for Load Balancing and Rate Limiting are prepared for future phases.
