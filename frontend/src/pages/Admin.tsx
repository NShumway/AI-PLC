import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

export default function Admin() {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return <Navigate to="/chat" />;
  }

  return (
    <div className="admin-container">
      <h1>Admin Portal</h1>
      <p>Admin functionality will be implemented in Phase 3</p>
      <a href="/chat">Back to Chat</a>
    </div>
  );
}
