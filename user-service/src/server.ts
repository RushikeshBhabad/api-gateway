import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import oauthRoutes from './routes/oauthRoutes';
import cookieParser from 'cookie-parser';
import passport from './config/passport';

dotenv.config({ path: '../.env' });

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

app.use('/auth', authRoutes);
app.use('/auth', oauthRoutes);
app.use('/users', userRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

const PORT = process.env.PORT_USER || 3001;
const MONGODB_URI = process.env.MONGODB_URI as string;

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('User Service connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`User Service running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
