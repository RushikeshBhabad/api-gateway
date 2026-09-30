import { Router } from 'express';
import * as productController from '../controllers/productController';

const router = Router();
router.get('/', productController.getProducts);
router.get('/:id', productController.getProduct);
// Note: Internal route for Order service
router.put('/:id/reserve', productController.reserveStock);

router.post('/', productController.createProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

export default router;
