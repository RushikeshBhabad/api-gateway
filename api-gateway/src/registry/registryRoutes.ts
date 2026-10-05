import { Router, Request, Response } from 'express';
import express from 'express';
import { serviceRegistry } from '../loadbalance/ServiceRegistry';

export const registryRouter = Router();

// Ensure body parser is applied specifically for registry endpoints
registryRouter.use(express.json());

/**
 * GET /registry
 * Query all registered services, their instances, and health status.
 */
registryRouter.get('/', (req: Request, res: Response) => {
  const allServices = serviceRegistry.getAllServices();
  let totalInstances = 0;
  let healthyInstances = 0;

  for (const instances of Object.values(allServices)) {
    totalInstances += instances.length;
    healthyInstances += instances.filter(i => i.healthy).length;
  }

  res.status(200).json({
    success: true,
    totalServices: Object.keys(allServices).length,
    totalInstances,
    healthyInstances,
    services: allServices
  });
});

/**
 * POST /registry/register
 * Service self-registration endpoint called when a service boots up.
 */
registryRouter.post('/register', (req: Request, res: Response) => {
  const { serviceName, port, host, id, weight, url } = req.body || {};

  if (!serviceName || !port) {
    res.status(400).json({
      success: false,
      error: 'Missing required fields: serviceName and port are required.'
    });
    return;
  }

  const parsedPort = Number(port);
  if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    res.status(400).json({
      success: false,
      error: 'Invalid port number.'
    });
    return;
  }

  const instance = serviceRegistry.registerInstance({
    serviceName,
    port: parsedPort,
    host: host || req.hostname || 'localhost',
    id,
    weight: weight ? Number(weight) : 1,
    url
  });

  res.status(200).json({
    success: true,
    message: `Instance registered successfully for ${serviceName}`,
    instance
  });
});

/**
 * POST /registry/heartbeat
 * Periodic heartbeat ping from active instances.
 */
registryRouter.post('/heartbeat', (req: Request, res: Response) => {
  const { serviceName, instanceId, id } = req.body || {};
  const targetId = instanceId || id;

  if (!serviceName || !targetId) {
    res.status(400).json({
      success: false,
      error: 'Missing required fields: serviceName and instanceId are required.'
    });
    return;
  }

  const acknowledged = serviceRegistry.recordHeartbeat(serviceName, targetId);

  if (!acknowledged) {
    res.status(404).json({
      success: false,
      error: 'Instance not found in registry. Please re-register.'
    });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Heartbeat acknowledged',
    instanceId: targetId
  });
});

/**
 * POST /registry/unregister
 * Deregistration endpoint called on graceful shutdown.
 */
registryRouter.post('/unregister', (req: Request, res: Response) => {
  const { serviceName, instanceId, id } = req.body || {};
  const targetId = instanceId || id;

  if (!serviceName || !targetId) {
    res.status(400).json({
      success: false,
      error: 'Missing required fields: serviceName and instanceId are required.'
    });
    return;
  }

  const unregistered = serviceRegistry.unregisterInstance(serviceName, targetId);

  res.status(200).json({
    success: true,
    message: unregistered
      ? `Instance ${targetId} unregistered successfully`
      : `Instance ${targetId} was not found (already removed)`
  });
});

/**
 * DELETE /registry/:serviceName/:instanceId
 * RESTful unregister convenience endpoint.
 */
registryRouter.delete('/:serviceName/:instanceId', (req: Request, res: Response) => {
  const { serviceName, instanceId } = req.params;

  if (!serviceName || !instanceId) {
    res.status(400).json({ success: false, error: 'serviceName and instanceId params required' });
    return;
  }

  const unregistered = serviceRegistry.unregisterInstance(serviceName, instanceId);

  res.status(200).json({
    success: true,
    message: unregistered
      ? `Instance ${instanceId} unregistered successfully`
      : `Instance ${instanceId} was not found`
  });
});

