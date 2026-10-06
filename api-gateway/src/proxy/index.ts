import { Application } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { LoadBalancerFactory } from '../loadbalance/LoadBalancerFactory';
import { serviceRegistry } from '../loadbalance/ServiceRegistry';
import { circuitBreakerRegistry } from '../circuitbreaker/CircuitBreakerRegistry';

export const setupProxies = (app: Application) => {
  serviceRegistry.startHealthChecks();
  const lbStrategy = LoadBalancerFactory.create();

  const createLbProxy = (serviceName: string, defaultPathRewrite: (path: string) => string): Options => {
    return {
      target: 'http://placeholder-target', // Will be overridden by router
      changeOrigin: true,
      router: (req) => {
        const instances = serviceRegistry.getInstances(serviceName);
        if (instances.length === 0) {
          throw new Error(`No healthy instances available for ${serviceName}`);
        }
        
        const context = {
          req,
          clientIp: req.ip || req.socket.remoteAddress,
          userId: (req as any).user?.id, // Assuming authMiddleware sets req.user
          requestPath: req.originalUrl,
        };

        const selectedInstance = lbStrategy.selectInstance(serviceName, instances, context);
        
        if (circuitBreakerRegistry.isEnabled()) {
          circuitBreakerRegistry.get(selectedInstance.id).recordRequest();
        }

        console.log(`[LOAD-BALANCER] strategy=${lbStrategy.name} service=${serviceName} selected=${selectedInstance.id} requestId=${(req.headers['x-request-id'] || 'unknown')}`);
        
        // Expose instance info on request for proxyRes/error hooks
        (req as any)._lbService = serviceName;
        (req as any)._lbInstance = selectedInstance;

        return selectedInstance.url;
      },
      pathRewrite: defaultPathRewrite,
      on: {
        proxyReq: (proxyReq, req, res) => {
          const instance = (req as any)._lbInstance;
          if (instance) {
            proxyReq.setHeader('x-lb-strategy', lbStrategy.name);
            proxyReq.setHeader('x-upstream-instance', instance.id);
          }
        },
        proxyRes: (proxyRes, req, res) => {
          const instance = (req as any)._lbInstance;
          const serviceName = (req as any)._lbService;
          
          if (instance) {
            res.setHeader('x-upstream-instance', instance.id);
            res.setHeader('x-upstream-url', instance.url);
            res.setHeader('x-lb-strategy', lbStrategy.name);

            if (circuitBreakerRegistry.isEnabled()) {
              const cb = circuitBreakerRegistry.get(instance.id);
              if (proxyRes.statusCode && proxyRes.statusCode >= 500) {
                cb.onFailure();
              } else {
                cb.onSuccess();
              }
            }
          }

          // Trigger request completion hook (useful for Least Connections)
          if (lbStrategy.onRequestComplete && serviceName && instance) {
            lbStrategy.onRequestComplete(serviceName, instance);
          }
        },
        error: (err, req, res) => {
          const instance = (req as any)._lbInstance;
          const serviceName = (req as any)._lbService;

          if (instance && circuitBreakerRegistry.isEnabled()) {
            circuitBreakerRegistry.get(instance.id).onFailure(err);
          }

          // Trigger request completion hook on error too
          if (lbStrategy.onRequestComplete && serviceName && instance) {
            lbStrategy.onRequestComplete(serviceName, instance);
          }
          
          console.error(`[Proxy Error] ${serviceName} / ${instance?.url || 'unknown'} : ${err.message}`);
          
          if (!res.headersSent) {
            (res as any).status(502).json({ error: 'Bad Gateway or Service Unavailable' });
          }
        }
      }
    };
  };

  app.use('/api/auth', createProxyMiddleware(createLbProxy('user-service', (path) => path.startsWith('/auth') ? path : `/auth${path}`)));
  app.use('/api/users', createProxyMiddleware(createLbProxy('user-service', (path) => path.startsWith('/users') ? path : `/users${path}`)));
  app.use('/api/products', createProxyMiddleware(createLbProxy('product-service', (path) => path.startsWith('/products') ? path : `/products${path}`)));
  app.use('/api/orders', createProxyMiddleware(createLbProxy('order-service', (path) => path.startsWith('/orders') ? path : `/orders${path}`)));
};
