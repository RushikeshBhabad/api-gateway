import { v4 as uuidv4 } from 'uuid';
import Product from '../models/Product';
import ReconciliationTask, { type IReconciliationTask } from '../models/ReconciliationTask';

export interface ReconciliationReport {
  totalProcessed: number;
  resolved: number;
  failed: number;
  tasks: Array<{
    taskId: string;
    productId: string;
    reservationId: string;
    quantity: number;
    action: string;
    success: boolean;
    alreadyApplied?: boolean;
    error?: string;
  }>;
}

export interface ReconcileOptions {
  staleTimeoutMs?: number;
  workerId?: string;
  maxTasks?: number;
}

/**
 * Crash-Consistent Inventory Reconciliation Worker for Standalone MongoDB.
 *
 * Correctness Guarantees:
 * 1. Mutual Exclusion Between Workers:
 *    Uses atomic findOneAndUpdate to claim each task by transitioning status
 *    from 'PENDING' (or expired 'PROCESSING') to 'PROCESSING' with a workerId and timestamp.
 *    No two workers can claim or execute the same task simultaneously.
 *
 * 2. Idempotent Single-Document Stock Increment:
 *    Uses conditional atomic update on Product:
 *      { _id: productId, reconciledTasks: { $ne: taskToken } }
 *      $inc: { stock: quantity }, $addToSet: { reconciledTasks: taskToken }
 *    Because stock increment and task recording occur in the same single-document atomic update,
 *    it is impossible for stock to be incremented without recording the taskToken.
 *
 * 3. Crash Recovery (Post-Increment Crash):
 *    If a worker process crashes after the stock increment but before updating the task to RESOLVED:
 *    The next worker (after staleTimeoutMs) claims the task, detects that taskToken is ALREADY
 *    present in product.reconciledTasks, SKIPS incrementing stock, and marks the task RESOLVED.
 *    Stock is guaranteed to be restored EXACTLY ONCE.
 */
export async function reconcilePendingTasks(options?: ReconcileOptions): Promise<ReconciliationReport> {
  const staleTimeoutMs = options?.staleTimeoutMs ?? 30000;
  const workerId = options?.workerId ?? `worker-${uuidv4()}`;
  const maxTasks = options?.maxTasks ?? 100;

  const report: ReconciliationReport = {
    totalProcessed: 0,
    resolved: 0,
    failed: 0,
    tasks: [],
  };

  while (report.totalProcessed < maxTasks) {
    const staleCutoff = new Date(Date.now() - staleTimeoutMs);

    // 1. Atomically claim a pending or abandoned task
    const task = await ReconciliationTask.findOneAndUpdate(
      {
        $or: [
          { status: 'PENDING' },
          { status: 'PROCESSING', lockedAt: { $lt: staleCutoff } },
        ],
      },
      {
        $set: {
          status: 'PROCESSING',
          lockedAt: new Date(),
          lockedBy: workerId,
        },
        $inc: { attempts: 1 },
      },
      { new: true }
    );

    if (!task) {
      // No more tasks available to claim
      break;
    }

    report.totalProcessed++;
    const taskIdStr = String(task._id);
    const taskToken = `task:${taskIdStr}`;

    try {
      if (task.action === 'RESTORE_STOCK') {
        // 2. Perform conditional atomic increment on the Product
        // Only increments if taskToken is NOT already in reconciledTasks
        const productUpdate = await Product.findOneAndUpdate(
          {
            _id: task.productId,
            reconciledTasks: { $ne: taskToken },
          },
          {
            $inc: { stock: task.quantity },
            $addToSet: { reconciledTasks: taskToken },
          },
          { new: true }
        );

        let alreadyApplied = false;

        if (!productUpdate) {
          // Update failed: Either product does not exist, or taskToken was ALREADY applied before a previous crash!
          const existingProduct = await Product.findById(task.productId);
          if (!existingProduct) {
            throw new Error(`Product '${task.productId}' not found in database`);
          }

          const existingReconciled = (existingProduct as any).reconciledTasks || [];
          if (existingReconciled.includes(taskToken)) {
            // CRASH RECOVERY: The previous worker crashed after incrementing stock but before marking task RESOLVED!
            alreadyApplied = true;
            console.warn(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'WARN',
                event: 'RECONCILIATION_ALREADY_APPLIED_CRASH_RECOVERED',
                taskId: taskIdStr,
                productId: task.productId,
                quantity: task.quantity,
                message: 'Task was already applied to product inventory prior to crash; skipping double-increment',
              })
            );
          } else {
            throw new Error(`Conditional update on product '${task.productId}' failed unexpectedly`);
          }
        }

        // 3. Mark task as RESOLVED
        task.status = 'RESOLVED';
        task.resolvedAt = new Date();
        task.lockedBy = undefined;
        await task.save();

        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'INFO',
            event: 'RECONCILIATION_TASK_RESOLVED',
            taskId: taskIdStr,
            productId: task.productId,
            reservationId: task.reservationId,
            quantity: task.quantity,
            alreadyApplied,
            workerId,
          })
        );

        report.resolved++;
        report.tasks.push({
          taskId: taskIdStr,
          productId: task.productId,
          reservationId: task.reservationId,
          quantity: task.quantity,
          action: task.action,
          success: true,
          alreadyApplied,
        });
      }
    } catch (err: any) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          event: 'RECONCILIATION_TASK_FAILED',
          taskId: taskIdStr,
          productId: task.productId,
          reservationId: task.reservationId,
          error: err.message,
          workerId,
        })
      );

      task.status = 'FAILED';
      task.errorDetails = err.message;
      task.lockedBy = undefined;
      await task.save().catch(() => {});

      report.failed++;
      report.tasks.push({
        taskId: taskIdStr,
        productId: task.productId,
        reservationId: task.reservationId,
        quantity: task.quantity,
        action: task.action,
        success: false,
        error: err.message,
      });
    }
  }

  return report;
}
