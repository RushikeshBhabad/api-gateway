import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import dotenv from 'dotenv';
import productRoutes from './routes/productRoutes';

dotenv.config({ path: '../.env' });

const app = express();

app.use(helmet());
app.use(express.json());

app.use('/products', productRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

const PORT = process.env.PORT_PRODUCT || 3002;
const MONGODB_URI = process.env.MONGODB_URI as string;

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Product Service connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Product Service running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
