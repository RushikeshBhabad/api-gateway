# Application Gateway Architecture & Data Flow

This document provides a deep, file-by-file walkthrough of the **API Gateway** and explains exactly how it acts as the central orchestrator for the microservice ecosystem, with a specific focus on how it links to the **User Service**.

---

## 1. What is the API Gateway?

In a microservices architecture, you have multiple isolated backends (User Service, Product Service, Order Service). Without an API Gateway, the Frontend (`localhost:5173`) would have to keep track of every service's port (3001, 3002, 3003) and send requests directly to them. 

The **API Gateway** (`localhost:8000`) acts as a single point of entry. The Frontend only talks to the Gateway. The Gateway's job is to:
1. **Receive** the incoming HTTP request.
2. **Authenticate & Authorize** the user.
3. **Route (Proxy)** the request to the correct internal microservice.

---

## 2. File-to-File Execution Flow (The Journey of a Request)

Let's trace exactly what happens when the frontend sends a request to `GET /api/users/me` (fetching the user profile).

### Step 1: The Entry Point (`api-gateway/src/server.ts`)
The request arrives at the Gateway's main server file.
1. The Gateway attaches a unique `x-request-id` header using `uuidv4()`. This is used for logging so we can track this exact request across all microservices.
2. The Gateway processes CORS (Cross-Origin Resource Sharing) to ensure the request is coming from our trusted frontend (`http://localhost:5173`).
3. The request hits this crucial line:
   ```typescript
   app.use('/api', authMiddleware);
   ```
   This stops the request from going any further. It hands the request over to `authMiddleware.ts`.

### Step 2: The Security Check (`api-gateway/src/middleware/authMiddleware.ts`)
This file is the bouncer. It must decide if the request is allowed to continue.
1. **Public Check**: It checks if the route is public (e.g., `/api/auth/login`). If so, it skips security and goes to Step 4. Since our request is `/api/users/me`, it is private.
2. **Authentication**: It calls the `JWTAuthentication` strategy.
   ```typescript
   const authContext = await authStrategy.authenticate(req);
   ```
   This jumps into `api-gateway/src/authentication/JWTAuthentication.ts`, where the Gateway mathematically validates the `Bearer` token using the `JWT_SECRET`. It extracts the `userId` and `role` (e.g., `USER`).
3. **Authorization**: It calls the `RBACAuthorization` strategy.
   ```typescript
   authzStrategy.authorize(authContext.role, req.method, path)
   ```
   This jumps into `api-gateway/src/authorization/RBACAuthorization.ts`, where it checks if a `USER` is allowed to execute a `GET` on `/users/me`. The rules say yes.
4. **Header Injection**: The middleware injects the user's identity into the HTTP headers:
   ```typescript
   req.headers['x-user-id'] = authContext.userId;
   req.headers['x-user-role'] = authContext.role;
   ```
5. **Next**: It calls `next()`, passing the request back to `server.ts`.

### Step 3: The Router / Proxy (`api-gateway/src/proxy/index.ts`)
Back in `server.ts`, the request hits:
```typescript
setupProxies(app);
```
Inside `proxy/index.ts`, the Gateway looks at the URL path (`/api/users/me`) and matches it to a rule:
```typescript
app.use('/api/users', createProxyMiddleware({ 
  target: 'http://localhost:3001', 
  changeOrigin: true,
  pathRewrite: { '^/api/users': '/users' }
}));
```
The `http-proxy-middleware` library physically intercepts the request, rewrites the URL from `/api/users/me` to just `/users/me`, and forwards the **entire HTTP request** (including the newly added `x-user-id` header) over the internal network to Port 3001 (The User Service).

---

## 3. How the API Gateway is Linked to the User Service

At this point, the Gateway's job is done. The request has arrived at the **User Service**. 
How does the User Service handle it?

### Step 4: User Service Entry (`user-service/src/server.ts`)
The request arrives at Port 3001. It hits the router:
```typescript
app.use('/users', userRoutes);
```

### Step 5: The Controller (`user-service/src/controllers/userController.ts`)
The request hits `getProfile(req, res)`. 
Notice what this function does:
```typescript
export const getProfile = async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id']; // Magic!
  const user = await User.findById(userId);
  res.status(200).json({ data: user });
};
```
**This is the ultimate link between the Gateway and the User Service.**
The User Service did absolutely no security checks. It didn't look for a JWT. It didn't verify a token. It simply looked at the `x-user-id` header that the API Gateway secretly attached in Step 2. 

Because the User Service is not exposed to the public internet (only the Gateway can talk to it), it completely trusts that `x-user-id` is accurate and secure.

### Step 6: The Response Journey
1. The User Service queries MongoDB and creates a JSON response with the user's profile data.
2. It sends this JSON response back to the API Gateway.
3. The API Gateway receives the JSON response and forwards it back to the React Frontend (`localhost:5173`).
4. The user sees their profile on the screen.

---

## Summary of the Relationship

- **API Gateway**: Handles 100% of the network routing, CORS, Token Verification, and Role Authorization. It protects the internal network.
- **User Service (Database ops)**: Handles 100% of the identity logic. It checks passwords during login, creates JWTs, and fetches user profiles from MongoDB. It relies on the Gateway to shield it from unauthorized requests.
