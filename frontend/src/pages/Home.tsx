import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

export default function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await axios.post('http://localhost:8000/api/auth/logout', {}, { withCredentials: true });
    } catch (e) {}
    logout();
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '30px', maxWidth: '850px', margin: '0 auto' }}>
      <header style={{ borderBottom: '2px solid #eee', paddingBottom: '20px', marginBottom: '30px' }}>
        <h1 style={{ color: '#2c3e50', margin: '0 0 15px 0' }}>📚 Bookstore Microservices Portal</h1>
        
        <nav style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link to="/products" style={{ textDecoration: 'none', color: '#3498db', fontWeight: 'bold' }}>
            📖 Browse Products
          </Link>

          {!user ? (
            <>
              <Link to="/login" style={{ textDecoration: 'none', color: '#27ae60', fontWeight: 'bold' }}>
                🔑 Login
              </Link>
              <Link to="/signup" style={{ textDecoration: 'none', color: '#2980b9', fontWeight: 'bold' }}>
                📝 Signup as User
              </Link>
              <Link 
                to="/signup?role=ADMIN" 
                style={{ 
                  textDecoration: 'none', 
                  backgroundColor: '#8e44ad', 
                  color: 'white', 
                  padding: '6px 12px', 
                  borderRadius: '4px',
                  fontWeight: 'bold' 
                }}
              >
                👑 Signup as Admin
              </Link>
              <button 
                onClick={() => window.location.href = 'http://localhost:8000/api/auth/google'} 
                style={{ 
                  background: '#ea4335', 
                  color: 'white', 
                  border: 'none', 
                  padding: '7px 14px', 
                  borderRadius: '4px', 
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                🌐 Google Login
              </button>
            </>
          ) : (
            <>
              <Link to="/profile" style={{ textDecoration: 'none', color: '#8e44ad', fontWeight: 'bold' }}>
                👤 My Profile
              </Link>
              <Link to="/orders" style={{ textDecoration: 'none', color: '#d35400', fontWeight: 'bold' }}>
                📦 My Orders
              </Link>
              <span style={{ background: '#f4f6f7', padding: '6px 12px', borderRadius: '20px', fontSize: '14px' }}>
                Logged in as: <strong>{user.name}</strong> ({user.role === 'ADMIN' ? '👑 ADMIN' : '👤 USER'})
              </span>
              <button 
                onClick={handleLogout}
                style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}
              >
                Logout
              </button>
            </>
          )}
        </nav>
      </header>

      <main>
        <section style={{ backgroundColor: '#f9f9f9', padding: '20px', borderRadius: '8px', marginBottom: '25px' }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Welcome to the Microservices Bookstore!</h3>
          <p style={{ margin: '0 0 10px 0' }}>This application routes all traffic through the centralized <strong>API Gateway</strong> (Port 8000):</p>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            <li><strong>User Service (Port 3001):</strong> Local & Google OAuth 2.0 Auth, JWT Token Issuing.</li>
            <li><strong>Product Service (Port 3002):</strong> Catalog management and Atomic Stock Reservation.</li>
            <li><strong>Order Service (Port 3003):</strong> Checkout and inter-service order placement.</li>
          </ul>
        </section>

        {!user ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={{ border: '1px solid #ddd', padding: '20px', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>👤 Customer Portal</h4>
              <p style={{ fontSize: '14px', color: '#555' }}>Sign up as a standard user to browse products and place book orders.</p>
              <button 
                onClick={() => navigate('/signup')} 
                style={{ background: '#3498db', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '4px', cursor: 'pointer', width: '100%', fontWeight: 'bold' }}
              >
                Create Standard User Account
              </button>
            </div>

            <div style={{ border: '2px solid #8e44ad', padding: '20px', borderRadius: '8px', backgroundColor: '#faf5fc' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#8e44ad' }}>👑 Administrator Portal</h4>
              <p style={{ fontSize: '14px', color: '#555' }}>Sign up with the Admin role to unlock book creation, inventory editing, and book deletion.</p>
              <button 
                onClick={() => navigate('/signup?role=ADMIN')} 
                style={{ background: '#8e44ad', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '4px', cursor: 'pointer', width: '100%', fontWeight: 'bold' }}
              >
                Create Admin Account
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <button 
              onClick={() => navigate('/products')} 
              style={{ background: '#27ae60', color: 'white', border: 'none', padding: '12px 24px', fontSize: '16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              🚀 Go to Book Catalog ({user.role === 'ADMIN' ? 'Manage Books' : 'Buy Books'})
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
