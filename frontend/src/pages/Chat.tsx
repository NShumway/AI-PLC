import { useAuth } from '../context/AuthContext';
import '../styles/Chat.css';

export default function Chat() {
  const { user, logout } = useAuth();

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>PLC Reference Chat</h1>
        <div className="user-info">
          <span>{user?.name} ({user?.role})</span>
          {user?.role === 'admin' && (
            <a href="/admin" className="admin-link">Admin Portal</a>
          )}
          <button onClick={logout} className="logout-btn">Logout</button>
        </div>
      </header>
      <div className="chat-content">
        <div className="placeholder">
          <h2>Phase 1 Complete! ✓</h2>
          <p>Authentication is working.</p>
          <p className="info">
            <strong>Next Steps:</strong>
            <br/>
            • Phase 2: Chat interface with RAG
            <br/>
            • Phase 3: PDF ingestion pipeline
            <br/>
            • Phase 4: Multi-topic interface
          </p>
        </div>
      </div>
    </div>
  );
}
