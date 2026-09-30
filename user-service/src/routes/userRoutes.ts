import { Router } from 'express';
import * as userController from '../controllers/userController';

const router = Router();
// Note: In real setup, the API Gateway authenticates and passes x-user-id.
router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);

export default router;
