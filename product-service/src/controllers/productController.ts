import { Request, Response } from 'express';
import Product from '../models/Product';

/**
 * Retrieves a paginated list of products.
 * Optionally filters products by search query, category, and price range.
 * @param req - Express Request object containing query parameters (page, limit, search, category, minPrice, maxPrice)
 * @param res - Express Response object
 */
export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const category = req.query.category as string;
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined;

    const query: any = {};
    if (search) {
      query.$text = { $search: search };
    }
    if (category) {
      query.category = category;
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) query.price.$gte = minPrice;
      if (maxPrice !== undefined) query.price.$lte = maxPrice;
    }

    const skip = (page - 1) * limit;
    const products = await Product.find(query).skip(skip).limit(limit);
    const total = await Product.countDocuments(query);

    res.status(200).json({ success: true, data: products, total, page, limit });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

/**
 * Retrieves a single product by its unique ID.
 * @param req - Express Request object containing the product ID in params
 * @param res - Express Response object
 */
export const getProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
       res.status(404).json({ success: false, error: { message: 'Not found' } });
       return;
    }
    res.status(200).json({ success: true, data: product });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

/**
 * Creates a new product. Restricted to ADMIN users only.
 * @param req - Express Request object containing product details in body
 * @param res - Express Response object
 */
export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json({ success: true, data: product });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

/**
 * Atomically reserves a specific quantity of stock for a product.
 * Fails if the requested quantity exceeds the available stock.
 * @param req - Express Request object containing product ID in params and quantity in body
 * @param res - Express Response object
 */
export const reserveStock = async (req: Request, res: Response): Promise<void> => {
  try {
    const { quantity } = req.body;
    
    // Atomic deduction ensuring stock doesn't go below 0
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { new: true }
    );

    if (!product) {
       res.status(400).json({ success: false, error: { message: 'Insufficient stock or not found' } });
       return;
    }

    res.status(200).json({ success: true, data: product });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

/**
 * Updates a product by ID. Restricted to ADMIN.
 */
export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) { res.status(404).json({ success: false, error: { message: 'Not found' } }); return; }
    res.status(200).json({ success: true, data: product });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

/**
 * Deletes a product by ID. Restricted to ADMIN.
 */
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) { res.status(404).json({ success: false, error: { message: 'Not found' } }); return; }
    res.status(200).json({ success: true, message: 'Deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};
