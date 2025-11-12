# Phase 4: Multi-Topic Chat Interface

## Overview
Build the multi-topic chat interface with a sidebar showing all system-wide topics. Enable users to switch between topic-specific chats and the "All Topics" chat, with proper topic filtering in vector search and separate chat histories per topic.

## Goals
- Add topic sidebar to chat UI
- Enable topic selection and switching
- Implement topic-specific vector search filtering
- Maintain separate chat histories per topic
- Test topic isolation and filtering accuracy
- Prepare for demo with multiple topics and books

## Key Features
- Sidebar lists all topics + "All Topics" option
- Clicking a topic loads that topic's chat history
- Topic-specific chats only retrieve from that topic's chunks
- "All Topics" searches across entire vector DB
- Visual indicator of current topic
- Smooth topic switching

## Backend Updates

### No Backend Changes Needed!
The backend from Phase 2 already supports topic filtering via the `topicId` parameter in the RAG service. The API routes already handle topic-specific and "All Topics" queries.

**Verify these endpoints work correctly**:
- `GET /api/topics` - Returns all topics
- `GET /api/topics/:id/messages` - Gets topic-specific history (null for "All Topics")
- `POST /api/topics/:id/messages` - Sends message to topic chat

## Frontend Implementation

### Enhanced Chat UI with Sidebar

```typescript
// src/pages/Chat.tsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import './Chat.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ book_title: string; page_number: number }>;
  created_at: string;
}

interface Topic {
  id: string | null; // null for "All Topics"
  name: string;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function Chat() {
  const { user, logout } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [currentTopic, setCurrentTopic] = useState<Topic>({
    id: null,
    name: 'All Topics',
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load topics on mount
  useEffect(() => {
    loadTopics();
  }, []);

  // Load chat history when topic changes
  useEffect(() => {
    loadChatHistory();
  }, [currentTopic]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadTopics = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/topics`, {
        withCredentials: true,
      });
      setTopics(response.data);
    } catch (error) {
      console.error('Error loading topics:', error);
    }
  };

  const loadChatHistory = async () => {
    try {
      const topicId = currentTopic.id === null ? 'null' : currentTopic.id;
      const response = await axios.get(
        `${API_URL}/api/topics/${topicId}/messages`,
        { withCredentials: true }
      );
      setMessages(response.data);
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input;
    setInput('');
    setLoading(true);

    try {
      const topicId = currentTopic.id === null ? 'null' : currentTopic.id;
      const response = await axios.post(
        `${API_URL}/api/topics/${topicId}/messages`,
        { content: userMessage },
        { withCredentials: true }
      );

      // Add both user and assistant messages
      setMessages(prev => [
        ...prev,
        response.data.userMessage,
        response.data.assistantMessage,
      ]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleTopicChange = (topic: Topic) => {
    setCurrentTopic(topic);
    // Messages will be loaded by useEffect
  };

  const handleClearHistory = async () => {
    if (!confirm('Are you sure you want to clear this chat history?')) {
      return;
    }

    try {
      const topicId = currentTopic.id === null ? 'null' : currentTopic.id;
      await axios.delete(`${API_URL}/api/topics/${topicId}/messages`, {
        withCredentials: true,
      });
      setMessages([]);
      alert('Chat history cleared');
    } catch (error) {
      console.error('Error clearing history:', error);
      alert('Failed to clear history');
    }
  };

  const renderCitations = (
    citations?: Array<{ book_title: string; page_number: number }>
  ) => {
    if (!citations || citations.length === 0) return null;

    return (
      <div className="citations">
        <strong>Sources:</strong>{' '}
        {citations.map((citation, index) => (
          <span key={index} className="citation">
            ({citation.book_title}, p. {citation.page_number})
            {index < citations.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h2>Topics</h2>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <div className="topics-list">
          {topics.map((topic) => (
            <button
              key={topic.id || 'all'}
              className={`topic-button ${
                currentTopic.id === topic.id ? 'active' : ''
              }`}
              onClick={() => handleTopicChange(topic)}
            >
              {topic.id === null && <span className="all-topics-icon">★</span>}
              {topic.name}
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="user-info">
            <p>{user?.name}</p>
            <p className="user-role">{user?.role}</p>
          </div>
          {user?.role === 'admin' && (
            <a href="/admin" className="admin-link">
              Admin Portal
            </a>
          )}
          <button onClick={logout} className="logout-button">
            Logout
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        <header className="chat-header">
          <div className="chat-header-content">
            <h1>{currentTopic.name}</h1>
            {currentTopic.id === null ? (
              <p className="topic-description">
                Searching across all topics
              </p>
            ) : (
              <p className="topic-description">
                Only searching within this topic
              </p>
            )}
          </div>
          <button onClick={handleClearHistory} className="clear-history-btn">
            Clear History
          </button>
        </header>

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h3>No messages yet</h3>
              <p>Ask a question about the PLC reference materials to get started!</p>
              {currentTopic.id === null ? (
                <p className="hint">
                  You're in "All Topics" - answers will come from any uploaded material.
                </p>
              ) : (
                <p className="hint">
                  You're in "{currentTopic.name}" - answers will only come from materials tagged with this topic.
                </p>
              )}
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <div className="message-header">
                  <span className="message-role">
                    {message.role === 'user' ? 'You' : 'PLC Assistant'}
                  </span>
                  <span className="message-timestamp">
                    {new Date(message.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <div className="message-content">{message.content}</div>
                {message.role === 'assistant' && renderCitations(message.citations)}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="input-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask a question about ${currentTopic.name}...`}
            disabled={loading}
            className="message-input"
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </form>
      </main>
    </div>
  );
}
```

### Enhanced Styles

```css
/* src/styles/Chat.css */
.chat-layout {
  display: flex;
  height: 100vh;
  background: #f5f5f5;
}

/* Sidebar Styles */
.sidebar {
  width: 280px;
  background: #2c3e50;
  color: white;
  display: flex;
  flex-direction: column;
  transition: transform 0.3s ease;
}

.sidebar.closed {
  transform: translateX(-240px);
}

.sidebar-header {
  padding: 1rem;
  background: #1a252f;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #34495e;
}

.sidebar-header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.sidebar-toggle {
  background: transparent;
  border: none;
  color: white;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.5rem;
}

.topics-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.topic-button {
  width: 100%;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
  background: transparent;
  border: 1px solid transparent;
  color: white;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.95rem;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.topic-button:hover {
  background: #34495e;
}

.topic-button.active {
  background: #3498db;
  border-color: #2980b9;
}

.all-topics-icon {
  font-size: 1.2rem;
}

.sidebar-footer {
  padding: 1rem;
  border-top: 1px solid #34495e;
  background: #1a252f;
}

.user-info {
  margin-bottom: 1rem;
}

.user-info p {
  margin: 0.25rem 0;
  font-size: 0.9rem;
}

.user-role {
  color: #95a5a6;
  font-size: 0.8rem;
  text-transform: uppercase;
}

.admin-link {
  display: block;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  background: #e67e22;
  color: white;
  text-align: center;
  text-decoration: none;
  border-radius: 4px;
  font-size: 0.9rem;
}

.admin-link:hover {
  background: #d35400;
}

.logout-button {
  width: 100%;
  padding: 0.5rem;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.logout-button:hover {
  background: #c0392b;
}

/* Main Chat Area */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
}

.chat-header {
  padding: 1rem 1.5rem;
  background: white;
  border-bottom: 2px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-header-content h1 {
  margin: 0 0 0.25rem 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.topic-description {
  margin: 0;
  color: #7f8c8d;
  font-size: 0.9rem;
}

.clear-history-btn {
  padding: 0.5rem 1rem;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.clear-history-btn:hover {
  background: #c0392b;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background: #f9f9f9;
}

.empty-state {
  text-align: center;
  color: #7f8c8d;
  margin-top: 3rem;
}

.empty-state h3 {
  margin: 0 0 0.5rem 0;
  color: #2c3e50;
}

.empty-state p {
  margin: 0.5rem 0;
}

.empty-state .hint {
  margin-top: 1rem;
  padding: 1rem;
  background: #ecf0f1;
  border-radius: 4px;
  font-size: 0.9rem;
}

.message {
  padding: 1rem;
  border-radius: 8px;
  max-width: 80%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.message.user {
  align-self: flex-end;
  background: #3498db;
  color: white;
}

.message.assistant {
  align-self: flex-start;
  background: white;
  color: #2c3e50;
  border: 1px solid #e0e0e0;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}

.message-role {
  font-weight: 600;
}

.message.user .message-role {
  color: rgba(255, 255, 255, 0.9);
}

.message.assistant .message-role {
  color: #7f8c8d;
}

.message-timestamp {
  opacity: 0.7;
  font-size: 0.8rem;
}

.message-content {
  line-height: 1.6;
  white-space: pre-wrap;
}

.citations {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  font-size: 0.85rem;
}

.message.user .citations {
  border-top-color: rgba(255, 255, 255, 0.3);
}

.message.assistant .citations {
  color: #7f8c8d;
}

.citation {
  font-style: italic;
}

.input-form {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: white;
  border-top: 2px solid #e0e0e0;
}

.message-input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 2px solid #e0e0e0;
  border-radius: 24px;
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.message-input:focus {
  border-color: #3498db;
}

.message-input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.input-form button {
  padding: 0.75rem 2rem;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 24px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
  transition: background 0.2s;
}

.input-form button:hover:not(:disabled) {
  background: #2980b9;
}

.input-form button:disabled {
  background: #bdc3c7;
  cursor: not-allowed;
}

/* Responsive Design */
@media (max-width: 768px) {
  .sidebar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 1000;
  }

  .sidebar.closed {
    transform: translateX(-100%);
  }

  .message {
    max-width: 90%;
  }
}
```

## Testing & Validation

### Topic Filtering Tests

#### 1. Setup Test Data
Upload PDFs to multiple topics:
- Topic A: "High School Math" - upload 2 math textbooks
- Topic B: "Elementary Science" - upload 2 science textbooks
- Topic C: "Social Studies" - upload 1 history textbook

#### 2. Test Topic Isolation
**Test Case 1**: High School Math topic
- Switch to "High School Math" topic
- Ask: "Explain quadratic equations"
- **Expected**: Answer with citations from math books only
- Ask: "Explain photosynthesis"
- **Expected**: "I don't have a reference in our PLC docs that answers that question." (science content is in different topic)

**Test Case 2**: Elementary Science topic
- Switch to "Elementary Science" topic
- Ask: "Explain photosynthesis"
- **Expected**: Answer with citations from science books
- Ask: "Explain quadratic equations"
- **Expected**: "I don't have a reference..." (math content is in different topic)

**Test Case 3**: All Topics
- Switch to "All Topics"
- Ask: "Explain quadratic equations"
- **Expected**: Answer from math books
- Ask: "Explain photosynthesis"
- **Expected**: Answer from science books
- Ask: "Compare algebra and biology"
- **Expected**: Answer using context from both topics

#### 3. Test Chat History Separation
- Send messages in "High School Math" topic
- Switch to "Elementary Science" topic
- **Expected**: Different chat history
- Switch back to "High School Math"
- **Expected**: Original chat history still there

#### 4. Test Clear History
- Clear history in one topic
- **Expected**: Only that topic's history cleared, others unaffected

### UI/UX Tests
- [ ] Sidebar displays all topics correctly
- [ ] "All Topics" is always shown first with star icon
- [ ] Current topic is highlighted
- [ ] Clicking topic switches context and loads history
- [ ] Sidebar can be collapsed and expanded
- [ ] Admin link shows for admin users only
- [ ] User info displays correctly
- [ ] Logout works
- [ ] Mobile responsive (sidebar overlays on small screens)

### Performance Tests
- [ ] Topic switching is smooth (< 500ms)
- [ ] Chat history loads quickly (< 1s)
- [ ] Large chat histories don't slow down UI
- [ ] Many topics (10+) don't cause issues

### Cross-Topic Query Tests

Test questions that could be answered by multiple topics:

**Setup**: Upload books about "Teaching Methods" to both math and science topics

**Test**:
- In "All Topics": Ask "What are effective teaching methods?"
- **Expected**: Citations from both math and science books
- In "High School Math": Same question
- **Expected**: Only citations from math books

## Demo Preparation

### Load Test Data

1. **High School Math** (Topic)
   - OpenStax Algebra textbook
   - OpenStax Calculus textbook

2. **Elementary Science** (Topic)
   - CK-12 Elementary Earth Science
   - OpenStax Concepts of Biology (simplified)

3. **Social Studies** (Topic)
   - OpenStax US History textbook

4. **Teaching Methods** (Topic)
   - Educational theory document
   - Classroom management guide

### Demo Script

#### Demo Flow 1: Knowledge Boundary (Empty State)
Before uploading any books:
1. Login as educator
2. Go to "All Topics"
3. Ask: "What is 2+2?"
4. **Show**: "I don't have a reference in our PLC docs..."
5. Ask: "Explain photosynthesis"
6. **Show**: Same refusal message
7. **Explain**: System never uses LLM training data, only uploaded content

#### Demo Flow 2: Upload & Knowledge Acquisition
1. Login as admin
2. Go to Admin Portal
3. Upload "OpenStax Algebra" to "High School Math" topic
4. Show processing status
5. Once complete, go back to chat
6. Ask same question: "Explain quadratic equations"
7. **Show**: Now gets answer with citations (Book Title, p. XX)

#### Demo Flow 3: Topic Filtering
1. Stay in "High School Math" topic
2. Ask: "Explain photosynthesis"
3. **Show**: Refusal (science content not in this topic)
4. Upload science book to "Elementary Science" topic
5. Switch to "Elementary Science" topic
6. Ask: "Explain photosynthesis"
7. **Show**: Now gets answer from science book
8. Ask: "Explain quadratic equations"
9. **Show**: Refusal (math content not in this topic)

#### Demo Flow 4: All Topics
1. Switch to "All Topics"
2. Ask: "Compare mathematical and scientific thinking"
3. **Show**: Answer drawing from both math and science books
4. **Show**: Citations from multiple sources

#### Demo Flow 5: Multi-Book Query
1. Upload second math book to "High School Math"
2. Ask question that spans both books
3. **Show**: Citations from both books in the same topic

#### Demo Flow 6: Chat History Persistence
1. Have conversation in "High School Math"
2. Switch to "Elementary Science", have different conversation
3. Switch back to "High School Math"
4. **Show**: Original conversation is preserved
5. Logout and login
6. **Show**: All chat histories still there

## Success Criteria

- [ ] Sidebar shows all topics dynamically
- [ ] "All Topics" option always available
- [ ] Topic switching works smoothly
- [ ] Chat history is maintained separately per topic
- [ ] Topic filtering works correctly (90%+ accuracy)
- [ ] "All Topics" searches across entire database
- [ ] Citations show correct sources from correct topics
- [ ] Empty topics show appropriate empty state
- [ ] Clear history works per topic
- [ ] UI is responsive on mobile devices
- [ ] Demo script executes successfully
- [ ] All knowledge boundary tests pass

## Final System Validation

### End-to-End Tests

1. **Full User Journey - Educator**:
   - [ ] Login with Google
   - [ ] Browse available topics
   - [ ] Ask questions in different topics
   - [ ] Receive accurate answers with citations
   - [ ] View and continue past conversations
   - [ ] Logout

2. **Full User Journey - Admin**:
   - [ ] Login with Google
   - [ ] Access admin portal
   - [ ] Create new topic
   - [ ] Upload PDF to topic
   - [ ] Monitor processing status
   - [ ] Test new content in chat
   - [ ] Delete book if needed
   - [ ] Logout

3. **System Integrity**:
   - [ ] Multiple users can use system simultaneously
   - [ ] Chat histories don't interfere between topics
   - [ ] Deleted books remove chunks from vector DB
   - [ ] System handles errors gracefully

## Production Readiness Checklist

- [ ] All environment variables set in production
- [ ] Database has proper indexes
- [ ] CORS configured correctly
- [ ] HTTPS enforced
- [ ] Session secrets are secure (not default)
- [ ] File upload limits set appropriately
- [ ] Error logging configured
- [ ] Rate limiting enabled (prevent abuse)
- [ ] Health check endpoint working
- [ ] Monitoring/alerting set up (CloudWatch)
- [ ] Backup strategy for PostgreSQL
- [ ] Cost monitoring enabled

## Known Limitations (Document for Users)

1. **PDF Page Numbers**: May be approximate due to pdf-parse limitations
2. **Text-only PDFs**: Scanned PDFs without OCR not supported
3. **Single Topic per PDF**: Cannot assign one PDF to multiple topics
4. **Manual Title Entry**: PDF title not auto-extracted
5. **No PDF Storage**: Cannot re-process PDFs or download originals
6. **Citation Accuracy**: Citations are based on chunking strategy, aim for >90% accuracy

## Future Enhancements (Out of Scope)

- Real-time processing status updates (WebSockets)
- Export chat history
- Share conversations between users
- Advanced analytics dashboard
- Question suggestions based on uploaded content
- Multi-topic PDF uploads
- PDF storage and re-processing
- Auto-detect PDF metadata

## Conclusion

After completing Phase 4, you have a fully functional AI-powered PLC coach with:
- ✅ Google OAuth authentication with role-based access
- ✅ Topic-based organization system
- ✅ PDF upload and processing with vector embeddings
- ✅ RAG-powered chat with strict knowledge boundaries
- ✅ Inline citations with page numbers
- ✅ Multi-topic chat interface with filtering
- ✅ Persistent chat history per topic
- ✅ Admin and educator portals

The system is ready for deployment and demo!
