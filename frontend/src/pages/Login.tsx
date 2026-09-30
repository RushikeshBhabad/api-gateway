import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      login(res.data.accessToken, res.data.user);
      navigate('/profile');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:8000/api/auth/google';
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '30px', maxWidth: '450px', margin: '40px auto', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
      <h2 style={{ textAlign: 'center', margin: '0 0 20px 0', color: '#2c3e50' }}>🔑 Account Login</h2>

      {error && (
        <div style={{ backgroundColor: '#ffebee', color: '#c62828', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '14px' }}>Email Address:</label>
          <input 
            type="email" 
            placeholder="e.g. user@bookstore.com" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            required 
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }} 
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '14px' }}>Password:</label>
          <input 
            type="password" 
            placeholder="••••••••" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            required 
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }} 
          />
        </div>

        <button 
          type="submit" 
          disabled={loading}
          style={{ 
            background: '#27ae60', 
            color: 'white', 
            border: 'none', 
            padding: '12px', 
            borderRadius: '4px', 
            fontWeight: 'bold', 
            cursor: 'pointer',
            marginTop: '10px'
          }}
        >
          {loading ? 'Logging in...' : 'Sign In'}
        </button>
      </form>

      <div style={{ textAlign: 'center', margin: '20px 0 10px 0', color: '#777', fontSize: '14px' }}>
        or
      </div>

      <button 
        onClick={handleGoogleLogin} 
        style={{ 
          width: '100%', 
          padding: '10px', 
          background: '#ea4335', 
          color: 'white', 
          border: 'none', 
          borderRadius: '4px', 
          fontWeight: 'bold', 
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}
      >
        🌐 Log In with Google OAuth 2.0
      </button>

      <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px' }}>
        Don't have an account? <Link to="/signup" style={{ color: '#3498db' }}>Sign Up as User</Link> | <Link to="/signup?role=ADMIN" style={{ color: '#8e44ad', fontWeight: 'bold' }}>Sign Up as Admin</Link>
      </div>
    </div>
  );
}
