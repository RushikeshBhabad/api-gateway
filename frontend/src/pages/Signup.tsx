import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';

export default function Signup() {
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    if (searchParams.get('role') === 'ADMIN') {
      setRole('ADMIN');
    }
  }, [searchParams]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/signup', { name, email, password, role });
      const res = await api.post('/auth/login', { email, password });
      login(res.data.accessToken, res.data.user);
      navigate('/profile');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:8000/api/auth/google';
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '30px', maxWidth: '450px', margin: '40px auto', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
      <h2 style={{ textAlign: 'center', margin: '0 0 20px 0', color: '#2c3e50' }}>
        {role === 'ADMIN' ? '👑 Admin Registration' : '📝 Create an Account'}
      </h2>

      {error && (
        <div style={{ backgroundColor: '#ffebee', color: '#c62828', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '14px' }}>Account Role:</label>
          <div style={{ display: 'flex', gap: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="role" 
                value="USER" 
                checked={role === 'USER'} 
                onChange={() => setRole('USER')} 
              />
              👤 Standard User
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#8e44ad', fontWeight: 'bold' }}>
              <input 
                type="radio" 
                name="role" 
                value="ADMIN" 
                checked={role === 'ADMIN'} 
                onChange={() => setRole('ADMIN')} 
              />
              👑 Administrator
            </label>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '14px' }}>Full Name:</label>
          <input 
            type="text" 
            placeholder="e.g. John Doe" 
            value={name} 
            onChange={e => setName(e.target.value)} 
            required 
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }} 
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '14px' }}>Email Address:</label>
          <input 
            type="email" 
            placeholder="e.g. admin@bookstore.com" 
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
            background: role === 'ADMIN' ? '#8e44ad' : '#3498db', 
            color: 'white', 
            border: 'none', 
            padding: '12px', 
            borderRadius: '4px', 
            fontWeight: 'bold', 
            cursor: 'pointer',
            marginTop: '10px'
          }}
        >
          {loading ? 'Registering...' : role === 'ADMIN' ? '👑 Register as Admin' : 'Sign Up'}
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
        🌐 Sign up with Google OAuth 2.0
      </button>

      <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px' }}>
        Already have an account? <Link to="/login" style={{ color: '#3498db' }}>Log In</Link> | <Link to="/" style={{ color: '#777' }}>Home</Link>
      </div>
    </div>
  );
}
