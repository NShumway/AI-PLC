# Phase 2: Chat Interface & RAG (Empty State)

## Overview
Build the chat interface and RAG (Retrieval-Augmented Generation) query system with strict knowledge boundaries. At this phase, the vector database will be empty, so the system should refuse to answer all questions, demonstrating that it only uses uploaded content and never falls back to LLM training data.

## Goals
- Build "All Topics" chat UI in frontend
- Implement vector similarity search with pgvector
- Integrate OpenAI API for chat completions
- Enforce strict knowledge boundaries (no LLM training data usage)
- Implement inline citation format
- Persist chat history per topic
- Test that system refuses all questions when database is empty

## Key Principle
**CRITICAL**: The system must NEVER use knowledge from the LLM's training data. It must ONLY respond based on content retrieved from the vector database. When no relevant content is found (or when the database is empty), it must respond: "I don't have a reference in our PLC docs that answers that question."

## Backend Implementation

### Required npm Packages
Add to your existing `package.json`:
```json
{
  "dependencies": {
    "openai": "^4.x.x",
    "langchain": "^0.1.x" // Optional: for text splitting utilities
  }
}
```

### Database Queries for Vector Search

```typescript
// src/services/vectorSearch.ts
import pool from '../config/database';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface SearchResult {
  id: string;
  text: string;
  book_title: string;
  page_number: number;
  similarity: number;
}

/**
 * Generate embedding for a query using OpenAI
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });

  return response.data[0].embedding;
}

/**
 * Search for similar chunks in the vector database
 * @param queryEmbedding - The embedding vector for the query
 * @param topicId - Optional topic ID to filter results (null for "All Topics")
 * @param limit - Number of results to return (default: 10)
 * @returns Array of similar chunks with metadata
 */
export async function searchSimilarChunks(
  queryEmbedding: number[],
  topicId: string | null = null,
  limit: number = 10
): Promise<SearchResult[]> {
  // Convert embedding array to pgvector format
  const embeddingString = `[${queryEmbedding.join(','')}]`;

  let query: string;
  let params: any[];

  if (topicId) {
    // Topic-specific search
    query = `
      SELECT
        id,
        text,
        book_title,
        page_number,
        1 - (embedding <=> $1::vector) AS similarity
      FROM document_chunks
      WHERE topic_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;
    params = [embeddingString, topicId, limit];
  } else {
    // All topics search
    query = `
      SELECT
        id,
        text,
        book_title,
        page_number,
        1 - (embedding <=> $1::vector) AS similarity
      FROM document_chunks
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    params = [embeddingString, limit];
  }

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Check if we have any chunks in the database
 */
export async function hasAnyChunks(): Promise<boolean> {
  const result = await pool.query('SELECT COUNT(*) as count FROM document_chunks');
  return parseInt(result.rows[0].count) > 0;
}
```

### RAG Query Service

```typescript
// src/services/rag.ts
import OpenAI from 'openai';
import { generateQueryEmbedding, searchSimilarChunks, hasAnyChunks } from './vectorSearch';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configurable similarity threshold
const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.5');

interface Citation {
  book_title: string;
  page_number: number;
}

interface RAGResponse {
  answer: string;
  citations: Citation[];
}

/**
 * Process a user query using RAG
 */
export async function processQuery(
  userQuery: string,
  topicId: string | null = null
): Promise<RAGResponse> {
  // Check if database is empty
  const hasChunks = await hasAnyChunks();
  if (!hasChunks) {
    return {
      answer: "I don't have a reference in our PLC docs that answers that question.",
      citations: [],
    };
  }

  // Generate embedding for the query
  const queryEmbedding = await generateQueryEmbedding(userQuery);

  // Search for similar chunks
  const results = await searchSimilarChunks(queryEmbedding, topicId, 10);

  // Check if we have any results above threshold
  if (results.length === 0 || results[0].similarity < SIMILARITY_THRESHOLD) {
    return {
      answer: "I don't have a reference in our PLC docs that answers that question.",
      citations: [],
    };
  }

  // Build context from top results (use top 5-10)
  const topResults = results.slice(0, 10);
  const context = topResults
    .map((result, index) => {
      return `[Source ${index + 1}] ${result.book_title}, p. ${result.page_number}\n${result.text}`;
    })
    .join('\n\n---\n\n');

  // Build the prompt with strict knowledge boundary
  const systemPrompt = `You are an AI assistant for a Professional Learning Community (PLC).
Your role is to answer questions EXCLUSIVELY based on the context provided below.

CRITICAL INSTRUCTIONS:
- DO NOT use any knowledge from your training data
- ONLY use information explicitly stated in the context below
- If the context does not contain enough information to answer the question, respond with: "I don't have a reference in our PLC docs that answers that question."
- Always cite your sources with book title and page number in format: (Book Title, p. XX)
- Use inline citations throughout your answer, not just at the end
- Do not make inferences beyond what is explicitly stated in the context
- Be concise and direct in your answers

Context:
${context}`;

  const userPrompt = `User question: ${userQuery}

Answer:`;

  // Call OpenAI API
  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview', // or 'gpt-3.5-turbo' for lower cost
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3, // Lower temperature for more factual responses
    max_tokens: 1000,
  });

  const answer = completion.choices[0].message.content ||
    "I don't have a reference in our PLC docs that answers that question.";

  // Extract unique citations from the results used
  const citations: Citation[] = topResults
    .map(result => ({
      book_title: result.book_title,
      page_number: result.page_number,
    }))
    // Remove duplicates
    .filter((citation, index, self) =>
      index === self.findIndex(c =>
        c.book_title === citation.book_title && c.page_number === citation.page_number
      )
    );

  return {
    answer,
    citations,
  };
}
```

### Chat API Routes

```typescript
// src/routes/chat.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { processQuery } from '../services/rag';
import pool from '../config/database';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/topics
 * Get all available topics
 */
router.get('/topics', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM topics ORDER BY name ASC');

    // Always include "All Topics" as a special option
    const topics = [
      { id: null, name: 'All Topics' },
      ...result.rows,
    ];

    res.json(topics);
  } catch (error) {
    console.error('Error fetching topics:', error);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

/**
 * GET /api/topics/:id/messages
 * Get chat history for a topic (null id for "All Topics")
 */
router.get('/topics/:id/messages', async (req, res) => {
  try {
    const topicId = req.params.id === 'null' ? null : req.params.id;

    let query: string;
    let params: any[];

    if (topicId) {
      query = `
        SELECT * FROM messages
        WHERE topic_id = $1
        ORDER BY created_at ASC
      `;
      params = [topicId];
    } else {
      query = `
        SELECT * FROM messages
        WHERE topic_id IS NULL
        ORDER BY created_at ASC
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/topics/:id/messages
 * Send a message and get AI response
 */
router.post('/topics/:id/messages', async (req, res) => {
  try {
    const topicId = req.params.id === 'null' ? null : req.params.id;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Save user message
    const userMessageResult = await pool.query(
      `INSERT INTO messages (topic_id, role, content, citations)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [topicId, 'user', content, null]
    );

    // Process query with RAG
    const { answer, citations } = await processQuery(content, topicId);

    // Save assistant response
    const assistantMessageResult = await pool.query(
      `INSERT INTO messages (topic_id, role, content, citations)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [topicId, 'assistant', answer, JSON.stringify(citations)]
    );

    // Return both messages
    res.json({
      userMessage: userMessageResult.rows[0],
      assistantMessage: assistantMessageResult.rows[0],
    });
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

/**
 * DELETE /api/topics/:id/messages
 * Clear chat history for a topic
 */
router.delete('/topics/:id/messages', async (req, res) => {
  try {
    const topicId = req.params.id === 'null' ? null : req.params.id;

    if (topicId) {
      await pool.query('DELETE FROM messages WHERE topic_id = $1', [topicId]);
    } else {
      await pool.query('DELETE FROM messages WHERE topic_id IS NULL');
    }

    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

export default router;
```

### Update Main Application
```typescript
// src/index.ts
// Add chat routes
import chatRoutes from './routes/chat';

// ... existing code ...

app.use('/api', chatRoutes);
```

## Frontend Implementation

### Required npm Packages
```json
{
  "dependencies": {
    "react": "^18.x.x",
    "react-dom": "^18.x.x",
    "react-router-dom": "^6.x.x",
    "axios": "^1.x.x"
  }
}
```

### Chat UI Component

```typescript
// src/pages/Chat.tsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ book_title: string; page_number: number }>;
  created_at: string;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function Chat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentTopic, setCurrentTopic] = useState<{ id: string | null; name: string }>({
    id: null,
    name: 'All Topics',
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat history on mount
  useEffect(() => {
    loadChatHistory();
  }, [currentTopic]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      setMessages(prev => [...prev, response.data.userMessage, response.data.assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderCitations = (citations?: Array<{ book_title: string; page_number: number }>) => {
    if (!citations || citations.length === 0) return null;

    return (
      <div className="citations">
        <strong>Sources:</strong>{' '}
        {citations.map((citation, index) => (
          <span key={index}>
            ({citation.book_title}, p. {citation.page_number})
            {index < citations.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>{currentTopic.name}</h1>
        <p>Logged in as: {user?.name} ({user?.role})</p>
      </header>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>No messages yet. Ask a question to get started!</p>
            <p><em>Note: Database is currently empty, so all questions will be refused.</em></p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="message-content">
                {message.content}
              </div>
              {message.role === 'assistant' && renderCitations(message.citations)}
              <div className="message-timestamp">
                {new Date(message.created_at).toLocaleString()}
              </div>
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
          placeholder="Ask a question..."
          disabled={loading}
          className="message-input"
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
```

### Basic Styles

```css
/* src/styles/Chat.css */
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 900px;
  margin: 0 auto;
  background: #fff;
}

.chat-header {
  padding: 1rem;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
}

.chat-header h1 {
  margin: 0 0 0.5rem 0;
  font-size: 1.5rem;
}

.chat-header p {
  margin: 0;
  color: #666;
  font-size: 0.9rem;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.empty-state {
  text-align: center;
  color: #666;
  margin-top: 2rem;
}

.message {
  padding: 1rem;
  border-radius: 8px;
  max-width: 80%;
}

.message.user {
  align-self: flex-end;
  background: #007bff;
  color: white;
}

.message.assistant {
  align-self: flex-start;
  background: #f1f1f1;
  color: #333;
}

.message-content {
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.citations {
  font-size: 0.85rem;
  color: #666;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #ddd;
}

.message.assistant .citations {
  color: #555;
}

.message-timestamp {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 0.25rem;
}

.message.assistant .message-timestamp {
  color: #999;
}

.input-form {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid #ddd;
  background: #f9f9f9;
}

.message-input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.message-input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.input-form button {
  padding: 0.75rem 1.5rem;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}

.input-form button:hover:not(:disabled) {
  background: #0056b3;
}

.input-form button:disabled {
  background: #ccc;
  cursor: not-allowed;
}
```

### Update App Router

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Chat from './pages/Chat';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/chat"
            element={
              <PrivateRoute>
                <Chat />
              </PrivateRoute>
            }
          />
          <Route path="/" element={<Navigate to="/chat" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
```

## Testing & Validation

### Backend Tests

#### 1. Test Vector Search with Empty Database
```bash
# Should return empty results
curl -X POST http://localhost:3001/api/topics/null/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "What is 2+2?"}' \
  --cookie "your-session-cookie"

# Expected response:
# {
#   "userMessage": {...},
#   "assistantMessage": {
#     "content": "I don't have a reference in our PLC docs that answers that question.",
#     "citations": []
#   }
# }
```

#### 2. Test Knowledge Boundary Enforcement
Test with various questions that the LLM would normally know:
- "What is 2+2?"
- "Who is the president of the United States?"
- "Explain photosynthesis"
- "What is the capital of France?"

**All should return**: "I don't have a reference in our PLC docs that answers that question."

#### 3. Test Chat History Persistence
- Send several messages
- Refresh the page
- Verify chat history is loaded correctly

### Frontend Tests
- [ ] Login redirects to chat page
- [ ] Chat UI renders correctly
- [ ] Can send messages
- [ ] Messages appear in chat history
- [ ] Loading state shows when sending message
- [ ] Empty state shows when no messages
- [ ] Citations render correctly (will test in Phase 3 with actual data)
- [ ] Timestamps display correctly

### Integration Tests
- [ ] Full flow: Login → Send message → Receive refusal → Message saved to database
- [ ] Chat history persists across sessions
- [ ] Multiple users can chat simultaneously without conflicts

## Environment Variables

### Add to Backend .env
```
OPENAI_API_KEY=your-openai-api-key
SIMILARITY_THRESHOLD=0.5
```

### Frontend .env (unchanged)
```
REACT_APP_API_URL=https://your-app-runner-url.awsapprunner.com
```

## Key Testing Points

### Phase 2 Success Criteria

- [ ] Chat UI is functional and responsive
- [ ] Users can send messages and receive responses
- [ ] **CRITICAL**: All questions receive the response "I don't have a reference in our PLC docs that answers that question." (because database is empty)
- [ ] System NEVER uses LLM training data to answer questions
- [ ] Chat history persists per topic (test with "All Topics")
- [ ] Messages are saved to database correctly
- [ ] Inline citation format is implemented (will show actual citations in Phase 3)
- [ ] Loading states work correctly
- [ ] Error handling works (network errors, API errors)

### Knowledge Boundary Tests (CRITICAL)

Test these questions explicitly to verify strict knowledge boundaries:
1. "What is 2+2?" → Refused
2. "Explain photosynthesis" → Refused
3. "Who wrote Romeo and Juliet?" → Refused
4. "What is the capital of France?" → Refused
5. "How do you calculate the area of a circle?" → Refused

**Expected Response for ALL**: "I don't have a reference in our PLC docs that answers that question."

## Troubleshooting

### Common Issues

1. **OpenAI API errors**:
   - Verify API key is set correctly
   - Check API quota/billing
   - Verify model name is correct

2. **Vector search not working**:
   - Verify pgvector extension is installed
   - Check that embedding dimension matches (1536 for text-embedding-3-small)
   - Verify HNSW index is created

3. **Empty responses**:
   - This is EXPECTED in Phase 2 (database is empty)
   - Verify the refusal message is correct

4. **Chat history not loading**:
   - Check database connection
   - Verify messages table has correct data
   - Check topic_id filtering logic

## Success Criteria

- [ ] Chat interface is fully functional
- [ ] RAG system correctly refuses all questions (empty database)
- [ ] Knowledge boundary enforcement is working (never uses LLM training)
- [ ] Chat history persists correctly
- [ ] Inline citation format is implemented
- [ ] System is ready for Phase 3 (PDF ingestion)

## Next Steps
After completing Phase 2, proceed to **Phase 3: PDF Ingestion Pipeline** to build the PDF upload functionality and populate the vector database with actual content.
