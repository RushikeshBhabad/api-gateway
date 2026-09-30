import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product';

dotenv.config({ path: '../.env' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bookstore';

const dummyBooks = [
  {
    title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    author: 'Robert C. Martin',
    category: 'Programming',
    price: 45,
    stock: 25,
    description: 'A handbook of agile software craftsmanship with best practices and design principles.',
    image: 'https://images.unsplash.com/photo-1532012164546-f432f2e3edd3'
  },
  {
    title: 'Design Patterns: Elements of Reusable Object-Oriented Software',
    author: 'Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides',
    category: 'System Design',
    price: 55,
    stock: 15,
    description: 'Classic software engineering book describing 23 design patterns.',
    image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c'
  },
  {
    title: 'Designing Data-Intensive Applications',
    author: 'Martin Kleppmann',
    category: 'Database',
    price: 60,
    stock: 30,
    description: 'The definitive guide to the architecture and concepts behind reliable, scalable data systems.',
    image: 'https://images.unsplash.com/photo-1512820790803-83ca734da794'
  },
  {
    title: 'Introduction to Algorithms (CLRS)',
    author: 'Thomas H. Cormen',
    category: 'Algorithms',
    price: 80,
    stock: 12,
    description: 'Comprehensive textbook on computer algorithms, data structures, and analysis.',
    image: 'https://images.unsplash.com/photo-1589829085413-56de8ae18c73'
  },
  {
    title: 'Deep Learning',
    author: 'Ian Goodfellow, Yoshua Bengio, Aaron Courville',
    category: 'AI/ML',
    price: 70,
    stock: 20,
    description: 'Broad survey of mathematical and conceptual background in deep learning.',
    image: 'https://images.unsplash.com/photo-1507842229451-7f01dd8629d8'
  },
  {
    title: 'Computer Networking: A Top-Down Approach',
    author: 'James Kurose, Keith Ross',
    category: 'Computer Networks',
    price: 65,
    stock: 18,
    description: 'An engaging approach to learning modern computer networking protocols.',
    image: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f'
  },
  {
    title: 'Operating Systems: Three Easy Pieces',
    author: 'Remzi H. Arpaci-Dusseau',
    category: 'Operating Systems',
    price: 40,
    stock: 22,
    description: 'Virtualization, concurrency, and persistence fundamentals.',
    image: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6'
  },
  {
    title: 'The Pragmatic Programmer',
    author: 'David Thomas, Andrew Hunt',
    category: 'Programming',
    price: 50,
    stock: 35,
    description: 'Journey to mastery in modern software craftsmanship.',
    image: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353'
  },
  {
    title: 'System Design Interview – An Insider\'s Guide',
    author: 'Alex Xu',
    category: 'System Design',
    price: 38,
    stock: 40,
    description: 'Step-by-step framework to tackle real-world system design interviews.',
    image: 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d'
  },
  {
    title: 'Artificial Intelligence: A Modern Approach',
    author: 'Stuart Russell, Peter Norvig',
    category: 'AI/ML',
    price: 85,
    stock: 10,
    description: 'The authoritative, most-used standard reference in artificial intelligence.',
    image: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570'
  }
];

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB for seeding');
  
  await Product.deleteMany({});
  console.log('Cleared existing products');
  
  await Product.insertMany(dummyBooks);
  console.log(`Successfully seeded ${dummyBooks.length} books!`);
  
  await mongoose.disconnect();
  console.log('Seeding finished.');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
