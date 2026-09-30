import { Application } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

/**
 * Configures reverse proxies for downstream microservices.
 * Routes traffic based on the URL path.
 * 
 * @param app - The Express application instance.
 */
export const setupProxies = (app: Application) => {
  // Proxy for User and Auth endpoints -> User Service
  app.use('/api/auth', createProxyMiddleware({ 
    target: process.env.USER_SERVICE_URL || 'http://localhost:3001', 
    changeOrigin: true,
    pathRewrite: (path) => path.startsWith('/auth') ? path : `/auth${path}`
  }));

  app.use('/api/users', createProxyMiddleware({ 
    target: process.env.USER_SERVICE_URL || 'http://localhost:3001', 
    changeOrigin: true,
    pathRewrite: (path) => path.startsWith('/users') ? path : `/users${path}`
  }));

  // Proxy for Product endpoints -> Product Service
  app.use('/api/products', createProxyMiddleware({ 
    target: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002', 
    changeOrigin: true,
    pathRewrite: (path) => path.startsWith('/products') ? path : `/products${path}`
  }));

  // Proxy for Order endpoints -> Order Service
  app.use('/api/orders', createProxyMiddleware({ 
    target: process.env.ORDER_SERVICE_URL || 'http://localhost:3003', 
    changeOrigin: true,
    pathRewrite: (path) => path.startsWith('/orders') ? path : `/orders${path}`
  }));
};
