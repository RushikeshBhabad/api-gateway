import { Request, Response } from 'express';
import Order from '../models/Order';
import axios from 'axios';

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002/products';

/**
 * Creates a new order for the authenticated user.
 * Communicates with the Product Service to verify product details and deduct stock.
 * Calculates the total amount and saves the order to the database.
 * @param req - Express Request object containing order items in body and user ID in headers
 * @param res - Express Response object
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
     res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No user ID' } });
     return;
  }

  const { items } = req.body;
  if (!items || !items.length) {
      res.status(400).json({ success: false, error: { message: 'Items required' } });
      return;
  }

  try {
    let totalAmount = 0;
    const finalItems = [];

    for (const item of items) {
      const prodRes = await axios.get(`${PRODUCT_SERVICE_URL}/${item.productId}`);
      const product = prodRes.data.data;

      await axios.put(`${PRODUCT_SERVICE_URL}/${item.productId}/reserve`, { quantity: item.quantity });

      totalAmount += product.price * item.quantity;
      finalItems.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price
      });
    }

    const order = new Order({
      userId,
      items: finalItems,
      totalAmount
    });
    await order.save();

    res.status(201).json({ success: true, data: order });
  } catch (error: any) {
    if (error.response) {
       res.status(error.response.status).json(error.response.data);
       return;
    }
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

/**
 * Retrieves all orders belonging to the currently authenticated user.
 * 
 * @param req - Express Request object containing user ID in headers
 * @param res - Express Response object
 */
export const getOrders = async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No user ID' } });
      return;
  }

  try {
    const orders = await Order.find({ userId });
    res.status(200).json({ success: true, data: orders });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

/**
 * Retrieves a specific order by its ID, ensuring it belongs to the authenticated user.
 * 
 * @param req - Express Request object containing the order ID in params and user ID in headers
 * @param res - Express Response object
 */
export const getOrder = async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'];
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
       res.status(404).json({ success: false, error: { message: 'Not found' } });
       return;
    }
    if (order.userId !== userId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not your order' } });
        return;
    }
    
    res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};
