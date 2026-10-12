import mongoose from 'mongoose';

export interface IReservation {
  _id: string;
  productId: string;
  quantity: number;
  status: 'RESERVED' | 'RELEASED' | 'CONFIRMED';
  createdAt?: Date;
  updatedAt?: Date;
}

const reservationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    productId: { type: String, required: true, index: true },
    quantity: { type: Number, required: true },
    status: {
      type: String,
      enum: ['RESERVED', 'RELEASED', 'CONFIRMED'],
      default: 'RESERVED',
      index: true,
    },
  },
  { _id: false, timestamps: true }
);

export default mongoose.model<IReservation>('Reservation', reservationSchema);
