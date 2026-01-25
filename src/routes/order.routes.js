import express from 'express';
import {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getCheckoutInfo,
  previewOrder,
  generateInvoice
} from '../controllers/order.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect); // All order routes exist protected

// Place specific routes before parameterized routes
router.get('/checkout-info', getCheckoutInfo);
router.post('/preview', previewOrder);

router.route('/')
  .post(createOrder)
  .get(getMyOrders);

router.route('/:id')
  .get(getOrderById);

router.get('/:id/invoice', generateInvoice);

router.route('/:id/cancel')
  .put(cancelOrder);

export default router;
