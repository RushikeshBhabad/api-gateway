import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Orders() {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    api.get('/orders')
      .then(res => setOrders(res.data.data))
      .catch(err => {
        console.error('Failed to fetch orders', err);
        if (err.response?.status === 401) {
            logout();
            navigate('/login');
        }
      });
  }, [user, navigate, logout]);

  return (
    <div style={{ padding: 20 }}>
      <h2>My Orders</h2>
      {orders.length === 0 ? <p>No orders found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {orders.map(order => (
            <div key={order._id} style={{ border: '1px solid #ccc', padding: '15px' }}>
              <p><strong>Order ID:</strong> {order._id}</p>
              <p><strong>Status:</strong> {order.status}</p>
              <p><strong>Total Amount:</strong> ${order.totalAmount}</p>
              <p><strong>Items:</strong></p>
              <ul>
                {order.items.map((item: any, idx: number) => (
                  <li key={idx}>Product ID: {item.productId} | Qty: {item.quantity} | Price: ${item.price}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <br />
      <button onClick={() => navigate('/')}>Back to Home</button>
    </div>
  );
}
