import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const services = [
  { name: 'API Gateway', dir: 'api-gateway', cmd: 'npm', args: ['start'] },
  { name: 'User Service', dir: 'user-service', cmd: 'npm', args: ['start'] },
  { name: 'Product Service', dir: 'product-service', cmd: 'npm', args: ['start'] },
  { name: 'Order Service', dir: 'order-service', cmd: 'npm', args: ['start'] },
  { name: 'Frontend UI', dir: 'frontend', cmd: 'npm', args: ['run', 'dev'] },
];

for (const s of services) {
  const p = spawn(s.cmd, s.args, {
    cwd: path.resolve(__dirname, s.dir),
    stdio: 'inherit',
    detached: false
  });
  p.on('error', (err) => console.error(`[${s.name}] error:`, err));
  p.on('exit', (code) => console.log(`[${s.name}] exited with code:`, code));
  console.log(`Started ${s.name} (PID: ${p.pid})`);
}

// Keep main process alive
setInterval(() => {}, 10000);
