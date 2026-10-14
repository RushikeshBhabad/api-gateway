import { Router, Request, Response } from 'express';
import express from 'express';
import { serviceRegistry } from '../loadbalance/ServiceRegistry';
import { registryAuthMiddleware } from './registrySecurity';
import {
  validateRegistrationPayload,
  validateServiceName,
  validateInstanceId
} from './registryValidation';

export const registryRouter = Router();

// Ensure body parser is applied specifically for registry endpoints
registryRouter.use(express.json());

// Protect ALL registry endpoints (mutations and inspection) with timing-safe authentication
registryRouter.use(registryAuthMiddleware);

/**
 * GET /registry
 * Query all registered services, their instances, and health status.
 * Protected: Exposes sensitive internal cluster topology.
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
 * Authenticated and validated against SSRF, rogue service identities, and invalid ports.
 */
registryRouter.post('/register', (req: Request, res: Response) => {
  const validation = validateRegistrationPayload(req.body);
  if (!validation.valid || !validation.value) {
    res.status(400).json({
      success: false,
      error: validation.error
    });
    return;
  }

  const { serviceName, port, host, id, weight, url } = validation.value;

  const instance = serviceRegistry.registerInstance({
    serviceName,
    port,
    host,
    id,
    weight,
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
  const rawId = instanceId || id;

  const serviceValidation = validateServiceName(serviceName);
  if (!serviceValidation.valid || !serviceValidation.value) {
    res.status(400).json({ success: false, error: serviceValidation.error });
    return;
  }

  const idValidation = validateInstanceId(rawId, '');
  if (!idValidation.valid || !idValidation.value) {
    res.status(400).json({ success: false, error: idValidation.error || 'instanceId is required.' });
    return;
  }

  const validServiceName = serviceValidation.value;
  const validId = idValidation.value;

  const acknowledged = serviceRegistry.recordHeartbeat(validServiceName, validId);

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
    instanceId: validId
  });
});

/**
 * POST /registry/unregister
 * Deregistration endpoint called on graceful shutdown.
 */
registryRouter.post('/unregister', (req: Request, res: Response) => {
  const { serviceName, instanceId, id } = req.body || {};
  const rawId = instanceId || id;

  const serviceValidation = validateServiceName(serviceName);
  if (!serviceValidation.valid || !serviceValidation.value) {
    res.status(400).json({ success: false, error: serviceValidation.error });
    return;
  }

  const idValidation = validateInstanceId(rawId, '');
  if (!idValidation.valid || !idValidation.value) {
    res.status(400).json({ success: false, error: idValidation.error || 'instanceId is required.' });
    return;
  }

  const validServiceName = serviceValidation.value;
  const validId = idValidation.value;

  const unregistered = serviceRegistry.unregisterInstance(validServiceName, validId);

  res.status(200).json({
    success: true,
    message: unregistered
      ? `Instance ${validId} unregistered successfully`
      : `Instance ${validId} was not found (already removed)`
  });
});

/**
 * DELETE /registry/:serviceName/:instanceId
 * RESTful unregister convenience endpoint.
 */
registryRouter.delete('/:serviceName/:instanceId', (req: Request, res: Response) => {
  const { serviceName, instanceId } = req.params;

  const serviceValidation = validateServiceName(serviceName);
  if (!serviceValidation.valid || !serviceValidation.value) {
    res.status(400).json({ success: false, error: serviceValidation.error });
    return;
  }

  const idValidation = validateInstanceId(instanceId, '');
  if (!idValidation.valid || !idValidation.value) {
    res.status(400).json({ success: false, error: idValidation.error || 'instanceId is required.' });
    return;
  }

  const validServiceName = serviceValidation.value;
  const validId = idValidation.value;

  const unregistered = serviceRegistry.unregisterInstance(validServiceName, validId);

  res.status(200).json({
    success: true,
    message: unregistered
      ? `Instance ${validId} unregistered successfully`
      : `Instance ${validId} was not found`
  });
});
