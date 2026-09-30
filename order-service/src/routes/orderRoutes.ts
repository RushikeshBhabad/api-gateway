import { Router } from 'express';
import * as orderController from '../controllers/orderController';

const router = Router();
router.post('/', orderController.createOrder);
router.get('/', orderController.getOrders);
router.get('/:id', orderController.getOrder);

export default router;
