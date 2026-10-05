import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import dotenv from 'dotenv';
import orderRoutes from './routes/orderRoutes';

dotenv.config({ path: '../.env' });

const app = express();

app.use(helmet());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[order-service][${process.env.SERVICE_INSTANCE_ID || 'default'}] ${req.method} ${req.originalUrl} requestId=${req.headers['x-request-id'] || 'unknown'}`);
  next();
});

app.use('/orders', orderRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'order-service',
    instance: process.env.SERVICE_INSTANCE_ID || 'default',
    port: process.env.PORT_ORDER || 3003
  });
});

const PORT = process.env.PORT_ORDER || 3003;
const MONGODB_URI = process.env.MONGODB_URI as string;

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Order Service connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Order Service running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
