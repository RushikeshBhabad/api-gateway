import { Router } from 'express';
import * as authController from '../controllers/authController';

const router = Router();
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

export default router;
