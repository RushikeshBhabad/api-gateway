const { startServiceInstance, startGateway, stopAll } = require('./process-manager');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log("Usage: node load-test.js <service> <num_instances> [STRATEGY]");
    console.log("Example: node load-test.js order 20 ROUND_ROBIN");
    process.exit(1);
  }

  const serviceType = args[0].toLowerCase();
  const numInstances = parseInt(args[1], 10);
  const strategy = args[2] || process.env.LOAD_BALANCER_STRATEGY || 'ROUND_ROBIN';

  if (!['user', 'product', 'order'].includes(serviceType)) {
    console.error("Invalid service. Must be user, product, or order.");
    process.exit(1);
  }

  if (isNaN(numInstances) || numInstances < 1) {
    console.error("Number of instances must be >= 1");
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 LOAD BALANCER TEST RUNNER`);
  console.log(`======================================================`);
  console.log(`Service:   ${serviceType}-service`);
  console.log(`Instances: ${numInstances}`);
  console.log(`Strategy:  ${strategy}`);
  console.log(`======================================================\n`);

  // Start microservice instances
  const basePort = {
    'user': 3000,
    'product': 4000,
    'order': 5000
  }[serviceType];

  const instancesByService = {
    [serviceType]: []
  };

  for (let i = 1; i <= numInstances; i++) {
    const port = basePort + i;
    const instanceId = `${serviceType}-${port}`;
    startServiceInstance(serviceType, port, instanceId, strategy);
    instancesByService[serviceType].push({ port, instanceId });
  }

  console.log(`\nWaiting 3 seconds for services to boot up...\n`);
  
  setTimeout(() => {
    // Start API Gateway
    startGateway(instancesByService, strategy);
    
    console.log(`\n✅ Ready! Press Ctrl+C to terminate all processes.\n`);
    console.log(`To test, run: node test/send-requests.js ${serviceType} 100 ${strategy}\n`);
  }, 3000);
}

main();
