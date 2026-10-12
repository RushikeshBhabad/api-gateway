import mongoose from 'mongoose';

export interface IReconciliationTask {
  _id?: string;
  productId: string;
  reservationId: string;
  quantity: number;
  action: 'RESTORE_STOCK';
  reason: string;
  status: 'PENDING' | 'PROCESSING' | 'RESOLVED' | 'FAILED';
  errorDetails?: string;
  lockedAt?: Date;
  lockedBy?: string;
  attempts?: number;
  resolvedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const reconciliationTaskSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, index: true },
    reservationId: { type: String, required: true, index: true },
    quantity: { type: Number, required: true },
    action: {
      type: String,
      enum: ['RESTORE_STOCK'],
      default: 'RESTORE_STOCK',
      required: true,
    },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'RESOLVED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    errorDetails: { type: String },
    lockedAt: { type: Date },
    lockedBy: { type: String },
    attempts: { type: Number, default: 0 },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<IReconciliationTask>('ReconciliationTask', reconciliationTaskSchema);

