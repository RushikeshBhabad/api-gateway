import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import dotenv from 'dotenv';
import productRoutes from './routes/productRoutes';

dotenv.config({ path: '../.env' });

const app = express();

app.use(helmet());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[product-service][${process.env.SERVICE_INSTANCE_ID || 'default'}] ${req.method} ${req.originalUrl} requestId=${req.headers['x-request-id'] || 'unknown'}`);
  
  // Failure injection for Circuit Breaker testing
  if (req.query.fail === 'true' || req.headers['x-fail'] === 'true') {
    const target = req.query.targetInstance || req.headers['x-target-instance'];
    const currentInstance = process.env.SERVICE_INSTANCE_ID || 'default';
    
    if (!target || target === currentInstance) {
      return res.status(500).json({ error: 'Injected Server Error' });
    }
  }
  
  next();
});

app.use('/products', productRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'product-service',
    instance: process.env.SERVICE_INSTANCE_ID || 'default',
    port: process.env.PORT || process.env.PORT_PRODUCT || 3002
  });
});

import { registerWithGateway } from './registry/registerService';

const PORT = process.env.PORT || process.env.PORT_PRODUCT || 3002;
const MONGODB_URI = process.env.MONGODB_URI as string;

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Product Service connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Product Service running on port ${PORT}`);
      registerWithGateway({
        serviceName: 'product-service',
        port: PORT,
        instanceId: process.env.SERVICE_INSTANCE_ID
      });
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
