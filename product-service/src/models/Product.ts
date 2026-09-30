import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  stock: { type: Number, required: true },
  description: { type: String, default: '' },
  image: { type: String, default: '' }
}, { timestamps: true });

productSchema.index({ title: 'text', author: 'text', category: 'text' });

export default mongoose.model('Product', productSchema);
