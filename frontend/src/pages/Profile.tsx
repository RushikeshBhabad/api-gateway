import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Profile() {
  const { user, accessToken, logout } = useAuth();
  const [profileData, setProfileData] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    api.get('/users/me')
      .then(res => setProfileData(res.data.data))
      .catch(err => {
        console.error('Failed to fetch profile', err);
        if (err.response?.status === 401) {
            logout();
            navigate('/login');
        }
      });
  }, [user, navigate, logout]);

  if (!profileData) return <div style={{ padding: 20 }}>Loading profile...</div>;

  return (
    <div style={{ padding: 20 }}>
      <h2>My Profile</h2>
      <div style={{ border: '1px solid #ccc', padding: '20px', maxWidth: '400px' }}>
        <p><strong>ID:</strong> {profileData._id}</p>
        <p><strong>Name:</strong> {profileData.name}</p>
        <p><strong>Email:</strong> {profileData.email}</p>
        <p><strong>Role:</strong> {profileData.role}</p>
        <p><strong>Auth Provider:</strong> {profileData.authProvider}</p>
      </div>
      <br />
      <button onClick={() => navigate('/')}>Back to Home</button>
    </div>
  );
}
