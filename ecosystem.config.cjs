module.exports = {
  apps: [
    {
      name: 'api-gateway',
      script: 'npm',
      args: 'start',
      cwd: './api-gateway',
      env: { NODE_ENV: 'development' }
    },
    {
      name: 'user-service',
      script: 'npm',
      args: 'start',
      cwd: './user-service',
      env: { NODE_ENV: 'development' }
    },
    {
      name: 'product-service',
      script: 'npm',
      args: 'start',
      cwd: './product-service',
      env: { NODE_ENV: 'development' }
    },
    {
      name: 'order-service',
      script: 'npm',
      args: 'start',
      cwd: './order-service',
      env: { NODE_ENV: 'development' }
    },
    {
      name: 'frontend',
      script: 'npm',
      args: 'run dev',
      cwd: './frontend',
      env: { NODE_ENV: 'development' }
    }
  ]
};
