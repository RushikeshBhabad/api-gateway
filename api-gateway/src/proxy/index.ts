import { Application } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { LoadBalancerFactory } from '../loadbalance/LoadBalancerFactory';
import { ServiceRegistry } from '../loadbalance/ServiceRegistry';

export const setupProxies = (app: Application) => {
  const serviceRegistry = new ServiceRegistry();
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
        
        const rawUserId = (req as any).user?.id || req.headers['x-user-id'] || req.headers['x-user'];
        const userId = Array.isArray(rawUserId) ? rawUserId[0] : (rawUserId ? String(rawUserId) : undefined);

        const context = {
          req,
          clientIp: req.ip || req.socket.remoteAddress,
          userId,
          requestPath: req.originalUrl,
        };

        const selectedInstance = lbStrategy.selectInstance(serviceName, instances, context);
        
        console.log(`[LOAD-BALANCER] strategy=${lbStrategy.name} service=${serviceName} selected=${selectedInstance.id} requestId=${(req.headers['x-request-id'] || 'unknown')}`);
        
        // Expose instance info on request for proxyRes/error hooks
        (req as any)._lbService = serviceName;
        (req as any)._lbInstance = selectedInstance;
        (req as any)._lbCompleted = false;

        const completeRequest = () => {
          if ((req as any)._lbCompleted) return;
          (req as any)._lbCompleted = true;
          if (lbStrategy.onRequestComplete && (req as any)._lbService && (req as any)._lbInstance) {
            lbStrategy.onRequestComplete((req as any)._lbService, (req as any)._lbInstance);
          }
        };

        // Attach completion hooks to response
        const res = (req as any).res;
        if (res) {
          res.once('finish', completeRequest);
          res.once('close', completeRequest);
        }

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
          
          if (instance) {
            res.setHeader('x-upstream-instance', instance.id);
            res.setHeader('x-upstream-url', instance.url);
            res.setHeader('x-lb-strategy', lbStrategy.name);
          }

          const completeRequest = () => {
            if ((req as any)._lbCompleted) return;
            (req as any)._lbCompleted = true;
            if (lbStrategy.onRequestComplete && (req as any)._lbService && (req as any)._lbInstance) {
              lbStrategy.onRequestComplete((req as any)._lbService, (req as any)._lbInstance);
            }
          };

          // Trigger completion when proxy response stream ends or closes
          proxyRes.once('end', completeRequest);
          proxyRes.once('close', completeRequest);
        },
        error: (err, req, res) => {
          const instance = (req as any)._lbInstance;
          const serviceName = (req as any)._lbService;

          if (!(req as any)._lbCompleted) {
            (req as any)._lbCompleted = true;
            if (lbStrategy.onRequestComplete && serviceName && instance) {
              lbStrategy.onRequestComplete(serviceName, instance);
            }
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
