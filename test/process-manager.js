const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const processes = [];

function startServiceInstance(serviceName, port, instanceId, strategy) {
  const serviceDir = path.join(__dirname, '..', `${serviceName}-service`);
  
  if (!fs.existsSync(serviceDir)) {
    console.error(`Directory not found: ${serviceDir}`);
    return null;
  }

  // The services are started with `npm start`
  // We will pass environment variables
  const env = {
    ...process.env,
    PORT: port.toString(),
    SERVICE_INSTANCE_ID: instanceId,
  };

  // We map the PORT to the correct ENV VAR expected by the legacy code in case they still use PORT_USER etc
  const portEnvNames = {
    'user': 'PORT_USER',
    'product': 'PORT_PRODUCT',
    'order': 'PORT_ORDER'
  };
  
  if (portEnvNames[serviceName]) {
    env[portEnvNames[serviceName]] = port.toString();
  }

  console.log(`Starting ${instanceId} on port ${port}...`);
  
  const child = spawn('npm', ['start'], {
    cwd: serviceDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'] // Only capture stdout/err to avoid terminal clutter
  });

  child.stdout.on('data', (data) => {
    // Optionally log this if debugging is needed, but mostly we ignore to keep terminal clean
    // console.log(`[${instanceId}] ${data.toString().trim()}`);
  });

  child.stderr.on('data', (data) => {
    // console.error(`[${instanceId} ERROR] ${data.toString().trim()}`);
  });

  child.on('error', (err) => {
    console.error(`[${instanceId}] Failed to start:`, err.message);
  });

  child.on('close', (code) => {
    console.log(`[${instanceId}] Exited with code ${code}`);
  });

  processes.push({ child, instanceId, port });
  return child;
}

function startGateway(instancesByService, strategy) {
  const gatewayDir = path.join(__dirname, '..', 'api-gateway');
  
  // Construct the multi-instance environment variables
  const env = { ...process.env };
  if (strategy) {
    env.LOAD_BALANCER_STRATEGY = strategy;
  }

  const envKeys = {
    'user': 'USER_SERVICE_INSTANCES',
    'product': 'PRODUCT_SERVICE_INSTANCES',
    'order': 'ORDER_SERVICE_INSTANCES'
  };

  for (const [serviceName, instances] of Object.entries(instancesByService)) {
    if (envKeys[serviceName]) {
      const urls = instances.map(p => `http://localhost:${p.port}`).join(',');
      env[envKeys[serviceName]] = urls;
    }
  }

  console.log(`Starting API Gateway with strategy ${strategy || 'ROUND_ROBIN'}...`);
  
  const child = spawn('npm', ['start'], {
    cwd: gatewayDir,
    env,
    stdio: 'inherit' // We want to see gateway logs
  });

  processes.push({ child, instanceId: 'api-gateway', port: 8000 });
  return child;
}

function stopAll() {
  console.log('\nStopping all test processes...');
  for (const proc of processes) {
    if (!proc.child.killed) {
      console.log(`Terminating ${proc.instanceId}...`);
      proc.child.kill('SIGTERM');
    }
  }
  process.exit(0);
}

// Handle Ctrl+C
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

module.exports = {
  startServiceInstance,
  startGateway,
  stopAll
};
