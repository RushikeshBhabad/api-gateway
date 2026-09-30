import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api';

export default function Products() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();

  // Admin form state
  const [newTitle, setNewTitle] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [newCategory, setNewCategory] = useState('Fiction');
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchProducts = () => {
    setLoading(true);
    api.get('/products')
      .then(res => setProducts(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleBuy = async (productId: string, title: string) => {
    if (!user) {
      alert('Please login first to place orders.');
      navigate('/login');
      return;
    }
    
    try {
      await api.post('/orders', {
        items: [{ productId, quantity: 1 }]
      });
      alert(`🎉 Success! 1 copy of "${title}" ordered. Stock updated in database.`);
      fetchProducts();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to place order.');
    }
  };

  const handleAddBook = async (e: any) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post('/products', {
        title: newTitle,
        author: newAuthor,
        category: newCategory,
        price: Number(newPrice),
        stock: Number(newStock)
      });
      alert('✅ Book successfully added to catalog by Admin!');
      setNewTitle('');
      setNewAuthor('');
      setNewPrice('');
      setNewStock('');
      fetchProducts();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to add book. Ensure you are logged in as ADMIN.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBook = async (productId: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;
    try {
      await api.delete(`/products/${productId}`);
      alert('🗑️ Book deleted successfully!');
      fetchProducts();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to delete book.');
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '30px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #eee', paddingBottom: '15px', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#2c3e50' }}>📚 Bookstore Products Catalog</h2>
          <p style={{ margin: '5px 0 0 0', color: '#7f8c8d' }}>Publicly accessible product catalog routed through the API Gateway</p>
        </div>
        <nav style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Link to="/" style={{ textDecoration: 'none', color: '#3498db' }}>🏠 Home</Link>
          {user ? (
            <>
              <Link to="/profile" style={{ textDecoration: 'none', color: '#8e44ad' }}>👤 Profile</Link>
              <Link to="/orders" style={{ textDecoration: 'none', color: '#d35400' }}>📦 Orders</Link>
              <span style={{ fontSize: '12px', background: user.role === 'ADMIN' ? '#8e44ad' : '#27ae60', color: 'white', padding: '3px 8px', borderRadius: '12px' }}>
                {user.role}
              </span>
            </>
          ) : (
            <Link to="/login" style={{ textDecoration: 'none', color: '#27ae60', fontWeight: 'bold' }}>🔑 Login</Link>
          )}
        </nav>
      </div>

      {/* Admin Panel */}
      {user?.role === 'ADMIN' && (
        <div style={{ backgroundColor: '#faf5fc', border: '2px dashed #8e44ad', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#8e44ad' }}>👑 Admin Controls: Add New Book to Catalog</h3>
          <form onSubmit={handleAddBook} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <input 
              placeholder="Book Title" 
              value={newTitle} 
              onChange={e => setNewTitle(e.target.value)} 
              required 
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <input 
              placeholder="Author" 
              value={newAuthor} 
              onChange={e => setNewAuthor(e.target.value)} 
              required 
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <input 
              placeholder="Category" 
              value={newCategory} 
              onChange={e => setNewCategory(e.target.value)} 
              required 
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <input 
              type="number" 
              placeholder="Price ($)" 
              value={newPrice} 
              onChange={e => setNewPrice(e.target.value)} 
              required 
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <input 
              type="number" 
              placeholder="Stock Quantity" 
              value={newStock} 
              onChange={e => setNewStock(e.target.value)} 
              required 
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <button 
              type="submit" 
              disabled={isSubmitting}
              style={{ background: '#8e44ad', color: 'white', border: 'none', padding: '10px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {isSubmitting ? 'Adding...' : '➕ Add Book'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading products from Product Service...</div>
      ) : products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>No products available in the database.</div>
      ) : (
        <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {products.map(p => (
            <div 
              key={p._id} 
              style={{ 
                border: '1px solid #e0e0e0', 
                borderRadius: '8px', 
                padding: '16px', 
                display: 'flex', 
                flexDirection: 'column',
                backgroundColor: 'white',
                boxShadow: '0 2px 5px rgba(0,0,0,0.04)'
              }}
            >
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#2c3e50' }}>{p.title}</h3>
              <p style={{ margin: '4px 0', color: '#7f8c8d', fontSize: '14px' }}>✍️ <strong>Author:</strong> {p.author}</p>
              <p style={{ margin: '4px 0', color: '#7f8c8d', fontSize: '14px' }}>🏷️ <strong>Category:</strong> {p.category}</p>
              <p style={{ margin: '8px 0 4px 0', fontSize: '18px', fontWeight: 'bold', color: '#27ae60' }}>💲{p.price}</p>
              <p style={{ margin: '4px 0 16px 0', fontSize: '13px', color: p.stock > 0 ? '#2980b9' : '#e74c3c', fontWeight: 'bold' }}>
                📦 In Stock: {p.stock} units
              </p>

              <div style={{ marginTop: 'auto', display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => handleBuy(p._id, p.title)} 
                  disabled={p.stock <= 0}
                  style={{ 
                    flex: 1, 
                    padding: '9px', 
                    background: p.stock > 0 ? '#27ae60' : '#bdc3c7', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '4px', 
                    cursor: p.stock > 0 ? 'pointer' : 'not-allowed',
                    fontWeight: 'bold'
                  }}
                >
                  {p.stock > 0 ? '🛒 Buy Now' : 'Out of Stock'}
                </button>

                {user?.role === 'ADMIN' && (
                  <button 
                    onClick={() => handleDeleteBook(p._id, p.title)} 
                    style={{ 
                      padding: '9px 12px', 
                      background: '#e74c3c', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '4px', 
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                    title="Delete product from database (Admin only)"
                  >
                    🗑️ Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
