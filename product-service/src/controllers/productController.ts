import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import Product from '../models/Product';
import Reservation from '../models/Reservation';
import ReconciliationTask from '../models/ReconciliationTask';
import { reconcilePendingTasks } from '../services/reconciliationService';
import { distributedLock } from '../lock/RedisDistributedLock';

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
  const productId = req.params.id;
  const quantity = Number(req.body.quantity);
  const reservationId = req.body.reservationId || uuidv4();

  // 1. Validate inputs
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    res.status(400).json({ success: false, error: { message: 'Invalid product ID' } });
    return;
  }
  if (!quantity || isNaN(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    res.status(400).json({ success: false, error: { message: 'Quantity must be a positive integer' } });
    return;
  }

  const resourceKey = `inventory:product:${productId}`;
  let lockHandle;

  try {
    // Acquire Redis Distributed Lock scoped to product
    lockHandle = await distributedLock.acquireLock(resourceKey);
  } catch (lockErr: any) {
    if (lockErr.statusCode === 503 || lockErr.name === 'RedisUnavailableError') {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: lockErr.message || 'Distributed locking service unavailable'
        }
      });
      return;
    }
    if (lockErr.statusCode === 409 || lockErr.name === 'LockAcquisitionTimeoutError') {
      res.status(409).json({
        success: false,
        error: {
          code: 'LOCK_ACQUISITION_TIMEOUT',
          message: lockErr.message || 'Could not acquire lock on product inventory'
        }
      });
      return;
    }
    res.status(500).json({ success: false, error: { message: lockErr.message } });
    return;
  }

  try {
    // 2. Inside critical section: Check for existing reservation (Idempotent Retry safety)
    const existingReservation = await Reservation.findById(reservationId);
    if (existingReservation) {
      // Ensure repeated reservationId is accepted ONLY when productId and quantity match
      if (existingReservation.productId !== productId || existingReservation.quantity !== quantity) {
        res.status(409).json({
          success: false,
          error: {
            code: 'RESERVATION_MISMATCH',
            message: `Reservation '${reservationId}' already exists with mismatched parameters (existing: product ${existingReservation.productId}, qty ${existingReservation.quantity}; requested: product ${productId}, qty ${quantity})`
          }
        });
        return;
      }

      if (existingReservation.status === 'RESERVED') {
        console.log(`[product-service] Idempotent retry detected for reservation ${reservationId}`);
        const currentProduct = await Product.findById(productId);
        if (!currentProduct) {
          res.status(404).json({
            success: false,
            error: {
              code: 'PRODUCT_NOT_FOUND',
              message: 'Product associated with reservation no longer exists'
            }
          });
          return;
        }
        res.status(200).json({
          success: true,
          data: currentProduct,
          reservationId,
          idempotentRetry: true
        });
        return;
      }

      if (existingReservation.status === 'RELEASED') {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_RESERVATION',
            message: 'Reservation has already been released and cannot be re-reserved'
          }
        });
        return;
      }

      if (existingReservation.status === 'CONFIRMED') {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_RESERVATION',
            message: 'Reservation has already been confirmed and cannot be re-reserved'
          }
        });
        return;
      }
    }

    // 3. Retrieve latest stock state from authoritative database
    const currentProduct = await Product.findById(productId);
    if (!currentProduct) {
      res.status(404).json({ success: false, error: { message: 'Product not found' } });
      return;
    }

    // 4. Check that available stock is sufficient
    if (currentProduct.stock < quantity) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock: requested ${quantity}, available ${currentProduct.stock}`
        }
      });
      return;
    }

    // 5. Perform the conditional atomic MongoDB decrement as final correctness safeguard
    const updatedProduct = await Product.findOneAndUpdate(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { new: true }
    );

    // 6. Handle reservation failure explicitly
    if (!updatedProduct) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: 'Insufficient stock or concurrent update prevented reservation'
        }
      });
      return;
    }

    // 7. Record reservation for safe idempotent compensation
    // If recording reservation fails, immediately roll back stock decrement to prevent leaked stock
    try {
      await Reservation.create({
        _id: reservationId,
        productId,
        quantity,
        status: 'RESERVED'
      });
    } catch (recordErr: any) {
      console.error(`[product-service] Failed to record reservation ${reservationId}:`, recordErr.message);

      let rollbackProduct = null;
      let rollbackErr: any = null;
      try {
        rollbackProduct = await Product.findByIdAndUpdate(
          productId,
          { $inc: { stock: quantity } },
          { new: true }
        );
      } catch (rbErr: any) {
        rollbackErr = rbErr;
      }

      if (rollbackProduct && !rollbackErr) {
        console.warn(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'WARN',
            event: 'RESERVATION_RECORD_FAILED_ROLLED_BACK',
            productId,
            reservationId,
            quantity,
            recordError: recordErr.message,
            restoredStock: rollbackProduct.stock
          })
        );
        res.status(500).json({
          success: false,
          error: {
            code: 'RESERVATION_RECORD_FAILED',
            message: 'Failed to record reservation; stock deduction was safely rolled back',
            rolledBack: true
          }
        });
        return;
      }

      // Rollback failed! Log structured FATAL error and persist reconciliation task
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'FATAL',
          event: 'INVENTORY_RECONCILIATION_REQUIRED',
          action: 'RESTORE_STOCK',
          productId,
          reservationId,
          quantity,
          recordError: recordErr.message,
          rollbackError: rollbackErr ? rollbackErr.message : 'Product document not found during rollback',
          message: 'Stock was decremented but reservation creation failed AND rollback failed. Immediate reconciliation required.'
        })
      );

      let taskPersisted = false;
      try {
        await ReconciliationTask.create({
          productId,
          reservationId,
          quantity,
          action: 'RESTORE_STOCK',
          reason: `Reservation.create failed (${recordErr.message}) and rollback failed (${rollbackErr ? rollbackErr.message : 'Product not found'})`,
          status: 'PENDING'
        });
        taskPersisted = true;
      } catch (taskErr: any) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'FATAL',
            event: 'RECONCILIATION_TASK_PERSISTENCE_FAILED',
            productId,
            reservationId,
            quantity,
            error: taskErr.message
          })
        );
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'RESERVATION_ROLLBACK_FAILED',
          message: taskPersisted
            ? 'Failed to record reservation and rollback failed; reconciliation task created for recovery'
            : 'Failed to record reservation and rollback failed; critical manual reconciliation required',
          rolledBack: false,
          reconciliationPending: taskPersisted
        }
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedProduct,
      reservationId
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  } finally {
    // 6. Release Redis lock in finally block
    if (lockHandle) {
      await lockHandle.release().catch((err: any) => {
        console.error(`[product-service] Error releasing lock for ${resourceKey}:`, err.message);
      });
    }
  }
};

/**
 * Compensates / releases previously reserved stock.
 * Protected by the same product-scoped Redis lock to prevent race conditions.
 * Idempotent: checks reservation status to prevent duplicate compensation.
 *
 * @param req - Express Request object containing product ID in params and quantity/reservationId in body
 * @param res - Express Response object
 */
export const releaseStock = async (req: Request, res: Response): Promise<void> => {
  const productId = req.params.id;
  const quantity = Number(req.body.quantity);
  const reservationId = req.body.reservationId;

  // 1. Validate inputs
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    res.status(400).json({ success: false, error: { message: 'Invalid product ID' } });
    return;
  }
  if (!quantity || isNaN(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    res.status(400).json({ success: false, error: { message: 'Quantity must be a positive integer' } });
    return;
  }

  const resourceKey = `inventory:product:${productId}`;
  let lockHandle;

  try {
    lockHandle = await distributedLock.acquireLock(resourceKey);
  } catch (lockErr: any) {
    if (lockErr.statusCode === 503 || lockErr.name === 'RedisUnavailableError') {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: lockErr.message || 'Distributed locking service unavailable'
        }
      });
      return;
    }
    if (lockErr.statusCode === 409 || lockErr.name === 'LockAcquisitionTimeoutError') {
      res.status(409).json({
        success: false,
        error: {
          code: 'LOCK_ACQUISITION_TIMEOUT',
          message: lockErr.message || 'Could not acquire lock for release'
        }
      });
      return;
    }
    res.status(500).json({ success: false, error: { message: lockErr.message } });
    return;
  }

  try {
    // Check idempotent compensation if reservationId is provided
    if (reservationId) {
      const existingReservation = await Reservation.findById(reservationId);
      if (!existingReservation) {
        res.status(404).json({
          success: false,
          error: { code: 'RESERVATION_NOT_FOUND', message: `Reservation '${reservationId}' not found` }
        });
        return;
      }

      if (existingReservation.productId !== productId) {
        res.status(400).json({
          success: false,
          error: {
            code: 'PRODUCT_MISMATCH',
            message: `Reservation '${reservationId}' belongs to product ${existingReservation.productId}, not ${productId}`
          }
        });
        return;
      }

      if (existingReservation.quantity !== quantity) {
        res.status(400).json({
          success: false,
          error: {
            code: 'QUANTITY_MISMATCH',
            message: `Mismatch in compensation quantity (reserved: ${existingReservation.quantity}, requested: ${quantity})`
          }
        });
        return;
      }

      if (existingReservation.status === 'RELEASED') {
        // Already compensated: idempotent no-op! Do NOT increment stock again!
        console.warn(`[product-service] Duplicate compensation attempted for reservation ${reservationId}. Safe no-op.`);
        const current = await Product.findById(productId);
        res.status(200).json({
          success: true,
          message: 'Reservation already compensated (idempotent)',
          data: current,
          alreadyCompensated: true
        });
        return;
      }

      if (existingReservation.status !== 'RESERVED') {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_RESERVATION_STATUS',
            message: `Reservation status is '${existingReservation.status}' and cannot be released`
          }
        });
        return;
      }

      // Atomically transition status from RESERVED to RELEASED in MongoDB
      const updatedReservation = await Reservation.findOneAndUpdate(
        { _id: reservationId, status: 'RESERVED' },
        { status: 'RELEASED' },
        { new: true }
      );

      if (!updatedReservation) {
        // A concurrent request just transitioned it!
        const recheck = await Reservation.findById(reservationId);
        if (recheck && recheck.status === 'RELEASED') {
          const current = await Product.findById(productId);
          res.status(200).json({
            success: true,
            message: 'Reservation already compensated (idempotent)',
            data: current,
            alreadyCompensated: true
          });
          return;
        }
        res.status(409).json({
          success: false,
          error: { code: 'CONCURRENT_COMPENSATION_CONFLICT', message: 'Concurrent modification of reservation' }
        });
        return;
      }
    }

    // Atomically increment stock back in database
    let updatedProduct = null;
    let incrementErr: any = null;
    try {
      updatedProduct = await Product.findByIdAndUpdate(
        productId,
        { $inc: { stock: quantity } },
        { new: true }
      );
    } catch (incErr: any) {
      incrementErr = incErr;
    }

    if (!updatedProduct || incrementErr) {
      let reverted = false;
      if (reservationId) {
        try {
          await Reservation.findByIdAndUpdate(reservationId, { status: 'RESERVED' });
          reverted = true;
        } catch (revErr: any) {
          console.error(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: 'FATAL',
              event: 'RESERVATION_STATUS_REVERT_FAILED',
              productId,
              reservationId,
              error: revErr.message
            })
          );
        }
      }

      if (!reverted && reservationId) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'FATAL',
            event: 'INVENTORY_RECONCILIATION_REQUIRED',
            action: 'RESTORE_STOCK',
            productId,
            reservationId,
            quantity,
            reason: 'Compensation stock increment failed and reservation status could not be reverted'
          })
        );
        try {
          await ReconciliationTask.create({
            productId,
            reservationId,
            quantity,
            action: 'RESTORE_STOCK',
            reason: 'Compensation stock increment failed and reservation status could not be reverted',
            status: 'PENDING'
          });
        } catch (taskErr: any) {}
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'COMPENSATION_FAILED',
          message: reverted
            ? 'Failed to restore stock; reservation status reverted to RESERVED for retry'
            : 'Failed to restore stock and could not revert reservation status; flagged for reconciliation',
          compensated: false
        }
      });
      return;
    }

    console.log(`[product-service] Compensated ${quantity} stock for product ${productId}. Restored stock: ${updatedProduct.stock}`);
    res.status(200).json({
      success: true,
      message: 'Stock successfully released / compensated',
      data: updatedProduct
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  } finally {
    if (lockHandle) {
      await lockHandle.release().catch((err: any) => {
        console.error(`[product-service] Error releasing lock for ${resourceKey}:`, err.message);
      });
    }
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

/**
 * Runs pending inventory reconciliation tasks.
 */
export const runReconciliation = async (req: Request, res: Response): Promise<void> => {
  try {
    const staleTimeoutMs = req.body?.staleTimeoutMs !== undefined ? Number(req.body.staleTimeoutMs) : undefined;
    const workerId = req.body?.workerId || undefined;
    const report = await reconcilePendingTasks({ staleTimeoutMs, workerId });
    res.status(200).json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};
