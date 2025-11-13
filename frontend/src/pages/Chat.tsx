import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../config/api';
import '../styles/Chat.css';

interface Topic {
  id: string | null;
  name: string;
}

interface Citation {
  book_title: string;
  page_number: number;
}

interface Message {
  id: string;
  topic_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[] | null;
  created_at: string;
}

export default function Chat() {
  const { user, logout } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load topics on mount
  useEffect(() => {
    loadTopics();
  }, []);

  // Load messages when topic changes
  useEffect(() => {
    if (selectedTopic !== null) {
      loadMessages();
    }
  }, [selectedTopic]);

  const loadTopics = async () => {
    try {
      const response = await api.get('/api/topics');
      setTopics(response.data);
      // Default to "All Topics" (null)
      if (response.data.length > 0) {
        setSelectedTopic(response.data[0].id);
      }
    } catch (err) {
      console.error('Error loading topics:', err);
      setError('Failed to load topics');
    }
  };

  const loadMessages = async () => {
    try {
      const topicParam = selectedTopic === null ? 'null' : selectedTopic;
      const response = await api.get(`/api/topics/${topicParam}/messages`);
      setMessages(response.data);
    } catch (err) {
      console.error('Error loading messages:', err);
      setError('Failed to load messages');
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim() || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const topicParam = selectedTopic === null ? 'null' : selectedTopic;
      const response = await api.post(`/api/topics/${topicParam}/messages`, {
        content: inputValue.trim()
      });

      // Add both user and assistant messages to state
      setMessages(prev => [
        ...prev,
        response.data.userMessage,
        response.data.assistantMessage
      ]);

      setInputValue('');
    } catch (err: any) {
      console.error('Error sending message:', err);
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = async () => {
    if (!window.confirm('Are you sure you want to clear this chat history?')) {
      return;
    }

    try {
      const topicParam = selectedTopic === null ? 'null' : selectedTopic;
      await api.delete(`/api/topics/${topicParam}/messages`);
      setMessages([]);
    } catch (err) {
      console.error('Error clearing chat:', err);
      setError('Failed to clear chat');
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <div className="header-left">
          <h1>PLC Reference Chat</h1>
          <select
            className="topic-selector"
            value={selectedTopic || 'null'}
            onChange={(e) => setSelectedTopic(e.target.value === 'null' ? null : e.target.value)}
          >
            {topics.map(topic => (
              <option key={topic.id || 'null'} value={topic.id || 'null'}>
                {topic.name}
              </option>
            ))}
          </select>
        </div>
        <div className="user-info">
          <span>{user?.name} ({user?.role})</span>
          {user?.role === 'admin' && (
            <a href="/admin" className="admin-link">Admin Portal</a>
          )}
          <button onClick={clearChat} className="clear-btn" disabled={messages.length === 0}>
            Clear Chat
          </button>
          <button onClick={logout} className="logout-btn">Logout</button>
        </div>
      </header>

      <div className="chat-content">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="welcome-message">
              <h2>Welcome to PLC Reference Chat!</h2>
              <p>Ask me questions about PLC programming and I'll answer based on the course materials.</p>
              <p className="info">Note: I can only answer questions based on documents that have been uploaded to the system.</p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <div className="message-content">
                    <div className="message-text">{message.content}</div>
                    {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
                      <div className="citations">
                        <strong>Sources:</strong>
                        <ul>
                          {message.citations.map((citation, index) => (
                            <li key={index}>
                              {citation.book_title}, Page {citation.page_number}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="message-timestamp">
                    {new Date(message.created_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <form className="message-input-form" onSubmit={sendMessage}>
          <input
            type="text"
            className="message-input"
            placeholder="Ask a question about PLC programming..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={isLoading || !inputValue.trim()}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
