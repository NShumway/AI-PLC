# AI-Powered PLC Coach - Technical Product Requirements Document

## 1. Executive Summary

Build an AI-powered chatbot that helps educators in Professional Learning Communities (PLCs) by answering questions based on uploaded educational textbooks. The system will ingest PDF textbooks, store them in a vector database, and use RAG (Retrieval-Augmented Generation) to provide cited, contextually relevant answers.

## 2. Core User Flows

### Flow 1: Admin Uploads Content
1. Admin logs in via Google SSO
2. Navigates to upload portal
3. Uploads PDF textbook with required metadata:
   - **PDF Title** (manual entry)
   - **TOPIC** (select existing or create new, e.g., "High School Math", "Elementary Science")
4. System processes PDF: extracts text, chunks it, embeds chunks with topic tag, stores in vector DB with page numbers and topic
5. Admin receives confirmation when processing complete

### Flow 2: Educator Asks Questions
1. Educator logs in via Google SSO
2. Selects a TOPIC from sidebar (e.g., "High School Math", "Elementary Science") OR uses "All Topics" chat
3. Types question in chat interface
4. System retrieves relevant chunks from vector DB (filtered by topic if specific topic selected, or unfiltered if "All Topics")
5. Generates response with inline citations (Book Title, p. XX)
6. Educator can ask follow-up questions in same conversation
7. Chat history persists across sessions per topic

### Flow 3: Demo Flow (Testing Knowledge Acquisition)
1. Ask question system cannot answer → shows "no relevant information found"
2. Upload relevant textbook
3. Ask same question → system now answers with citations from uploaded book

## 3. Technical Architecture

### Tech Stack
- **Frontend**: React (web application)
- **Backend**: Node.js (Express or similar)
- **Vector DB**: Self-hosted pgvector (PostgreSQL extension) or Qdrant
  - **Recommended**: pgvector for simplicity (single database for both relational and vector data)
  - **Alternative**: Qdrant (dedicated vector DB with rich filtering, Docker deployment)
- **LLM**: OpenAI API (GPT-4 or GPT-3.5-turbo)
- **Authentication**: Google OAuth 2.0 / OIDC
- **Hosting**: AWS (App Runner for backend, CloudFront + S3 for frontend)
- **Database**: PostgreSQL (for user data, chat history, document metadata, and vector storage with pgvector)

**Note**: PDFs are processed in memory and discarded after chunking/embedding. Original PDFs are NOT stored.

### System Components

#### 3.1 PDF Ingestion Pipeline
**Input**: PDF file + metadata (title - required, TOPIC - required)

**Process**:
1. Receive PDF upload (process in memory, do NOT store file)
2. Extract text from PDF (use library like `pdf-parse` or `pdfjs`)
3. Handle OCR if needed (though assume text-based PDFs for MVP)
4. Chunk text:
   - **Strategy**: Recursive character text splitting (industry standard)
   - **Chunk size**: ~1000 tokens with ~200 token overlap
   - **Preserve page numbers**: Track page number for each chunk during extraction
5. Generate embeddings for each chunk (OpenAI `text-embedding-3-small`)
6. Store in vector DB with metadata:
   ```json
   {
     "chunk_id": "uuid",
     "text": "chunk content",
     "embedding": [vector],
     "book_title": "Introduction to Algebra",
     "page_number": 42,
     "topic_id": "uuid",
     "topic_name": "High School Math"
   }
   ```
7. Store PDF metadata in PostgreSQL (book_id, title, topic_id, upload_date, uploaded_by, processing_status)
8. **Discard original PDF after successful processing**

**Error Handling**:
- If processing fails, return error immediately (user must re-upload)
- Show clear error messages to admin (e.g., "PDF corrupted", "Text extraction failed")
- No retry queue needed (user simply re-uploads on failure)

#### 3.2 Chat Interface & RAG System

**Query Flow**:
1. User sends message in a topic-specific chat (e.g., "High School Math") or "All Topics" chat
2. Generate embedding for user query
3. Vector similarity search in DB:
   - **Topic-specific chat**: Filter by topic_id
   - **"All Topics" chat**: No topic filter (search across entire vector DB)
4. Retrieve top 5-10 most relevant chunks (ranked by cosine similarity)
5. **Similarity threshold check**: If top result is below threshold (start with ~0.5-0.6, tune later), respond with "I don't have a reference in our PLC docs that answers that question"
6. Construct prompt for OpenAI with strict knowledge boundary:
   ```
   You are an AI assistant for a Professional Learning Community (PLC).
   Your role is to answer questions EXCLUSIVELY based on the context provided below.

   CRITICAL INSTRUCTIONS:
   - DO NOT use any knowledge from your training data
   - ONLY use information explicitly stated in the context below
   - If the context does not contain enough information to answer the question, respond with: "I don't have a reference in our PLC docs that answers that question."
   - Always cite your sources with book title and page number in format: (Book Title, p. XX)
   - Do not make inferences beyond what is explicitly stated in the context

   Context:
   [retrieved chunks with book titles and page numbers]

   User question: [user query]

   Answer:
   ```
7. Stream response back to user
8. Save message exchange to PostgreSQL (topic_id, role, content, citations, timestamp)

**Topic Filtering**:
- Each topic chat only retrieves chunks tagged with that topic
- "All Topics" chat retrieves from entire vector DB without topic filtering
- Chat history is maintained separately per topic

#### 3.3 Topic-Based System

**Topic Definition**:
- Topics are system-wide categories for organizing PDFs (e.g., "High School Math", "Elementary Science", "Social Studies")
- Topics are created during PDF upload (admin selects existing or creates new)
- All users see the same topics (not user-specific)
- Stored in PostgreSQL: `topics` table (id, name, created_at)

**Implementation**:
- Admins create topics during PDF upload (or select from existing topics)
- Topics appear in chat sidebar for all users
- Special "All Topics" chat always available (searches across all topics)
- When querying in topic-specific chat, vector search filters by topic_id
- Each topic maintains separate chat history
- UI: Sidebar shows list of topics + "All Topics" option

## 4. Database Schema

### PostgreSQL Tables

```sql
-- Users
users (
  id UUID PRIMARY KEY,
  google_id VARCHAR UNIQUE,
  email VARCHAR,
  name VARCHAR,
  role ENUM('admin', 'educator'),
  created_at TIMESTAMP
)

-- Topics (system-wide categories for PDFs)
topics (
  id UUID PRIMARY KEY,
  name VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
)

-- Books (PDF metadata)
books (
  id UUID PRIMARY KEY,
  title VARCHAR NOT NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id),
  processing_status ENUM('pending', 'processing', 'complete', 'failed'),
  created_at TIMESTAMP DEFAULT NOW()
  -- Note: Original PDF is NOT stored
)

-- Chat history (system-wide, organized by topic)
messages (
  id UUID PRIMARY KEY,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE, -- NULL for "All Topics" chat
  role ENUM('user', 'assistant'),
  content TEXT NOT NULL,
  citations JSONB, -- [{book_title, page_number}]
  created_at TIMESTAMP DEFAULT NOW()
)
```

### Vector DB Schema (pgvector)

```sql
-- Enable pgvector extension
CREATE EXTENSION vector;

-- Document chunks table with vector embeddings
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension
  page_number INTEGER NOT NULL,
  book_title VARCHAR NOT NULL,
  chunk_index INTEGER NOT NULL, -- Order within the document
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create HNSW index for fast similarity search
CREATE INDEX idx_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- Create indexes for metadata filtering
CREATE INDEX idx_book_id ON document_chunks(book_id);
CREATE INDEX idx_topic_id ON document_chunks(topic_id);
CREATE INDEX idx_book_title ON document_chunks(book_title);
```

**Deployment Notes**:
- Install pgvector as PostgreSQL extension on AWS RDS PostgreSQL instance
- HNSW index provides fast approximate nearest neighbor search for embeddings

## 5. API Endpoints

### Authentication
- `POST /auth/google` - Initiate Google OAuth flow
- `GET /auth/google/callback` - Handle OAuth callback
- `POST /auth/logout` - Logout user

### Admin - Content Management
- `POST /api/admin/books/upload` - Upload PDF (multipart/form-data: file, title, topic_id or new_topic_name)
- `GET /api/admin/books` - List all uploaded books
- `GET /api/admin/books/:id/status` - Check processing status
- `DELETE /api/admin/books/:id` - Delete book (and associated chunks)
- `GET /api/admin/topics` - List all topics
- `POST /api/admin/topics` - Create new topic

### Chat
- `GET /api/topics` - List all topics (with "All Topics" always included)
- `GET /api/topics/:id/messages` - Get chat history for a topic (NULL id for "All Topics")
- `POST /api/topics/:id/messages` - Send message, get AI response (NULL id for "All Topics")
- `DELETE /api/topics/:id/messages` - Clear chat history for a topic

## 6. UI Requirements

### Admin Portal (`/admin`)
**Access**: Role = 'admin' only

**Features**:
- Upload form:
  - File input (PDF only)
  - Text input: PDF title (required)
  - Dropdown: Select existing topic OR text input to create new topic (required)
- Book list table: columns (title, topic, upload date, status)
- Processing indicators (pending/processing/complete/failed)
- Delete button for each book
- Topics management: view all topics, create new topics

### Chat Portal (`/chat`)
**Access**: Role = 'educator' or 'admin'

**Features**:
- Sidebar: List of all topics + "All Topics" option (always at top)
- Main area: Chat interface (messages with timestamps, input box)
- Citations displayed inline: "(Introduction to Algebra, p. 42)"
- Current topic name displayed at top of chat
- Separate chat history for each topic
- Responsive design (mobile-friendly)

## 7. MVP Scope & Demo Requirements

### Must Build
- ✅ Google SSO authentication with 2 roles (admin, educator)
- ✅ PDF upload and ingestion pipeline (extract → chunk → embed → store with topic tagging)
- ✅ Vector DB storage with metadata (book title, page numbers, topic_id)
- ✅ Topic-based system (system-wide topics, create during upload, filter in chat)
- ✅ RAG-powered chat with inline citations (Book Title, p. XX)
- ✅ Persistent chat history per topic
- ✅ "All Topics" chat (searches across all topics)
- ✅ Separate admin portal (upload) and chat portal

### Demo Flow
1. **Show Empty State**: Ask question in "All Topics" chat → "I don't have a reference in our PLC docs that answers that question."
2. **Upload Content**: Admin uploads textbook with topic tag
3. **Show Knowledge Acquisition**: Ask same question → Detailed answer with inline citations
4. **Multi-Book Query**: Ask question that spans multiple books in same topic → Answer cites both books
5. **Topic Filtering**: Switch to topic-specific chat → Show filtered results from only that topic
6. **Knowledge Boundary Test**: Ask general knowledge question (e.g., "what is 2+2?") → System responds "I don't have a reference in our PLC docs that answers that question." (does NOT use LLM training data)

### Test Data
- Source: 10+ open-source PDF textbooks (e.g., OpenStax, CK-12)
- Variety: Different subjects (math, science, English) and grade levels (elementary, middle, high school)

## 8. Non-Functional Requirements

### Performance
- PDF processing: <5 minutes for 500-page book
- Chat response latency: <3 seconds (including LLM call)
- Support 50+ concurrent users

### Security
- All data encrypted in transit (HTTPS) and at rest
- Role-based access control (admin vs educator)
- Secure file upload (validate PDF format, scan for malware)
- API rate limiting to prevent abuse

### Scalability
- Vector DB should support 100K+ chunks initially
- Modular design to add more books/users over time

## 9. Out of Scope (For MVP)

- ❌ Clever SSO integration
- ❌ Voice or image inputs
- ❌ User uploads in chat (e.g., meeting notes, student data)
- ❌ Analytics dashboard or usage metrics
- ❌ Fine-tuning custom models
- ❌ Mobile native apps (web-only)
- ❌ Real-time collaboration features
- ❌ Advanced admin features (user management, content approval workflows)
- ❌ **PDF Storage** (S3 or file storage for original uploaded PDFs)
- ❌ **Auto-detect PDF title** (extracting title from PDF metadata or content)
- ❌ **Multi-topic PDF uploads** (assigning a single PDF to multiple topics simultaneously)

## 10. Future Enhancements (Post-MVP)

**⚠️ IMPORTANT: These features are NOT part of the MVP scope. They should only be considered after successful MVP launch.**

### PDF Storage & Re-processing
**Status**: NOT IN MVP SCOPE

While the MVP processes PDFs in memory and discards them after chunking/embedding, future versions could add:
- Store original PDFs in S3 for archival purposes
- Enable re-processing of documents if chunking strategy changes
- Allow admins to download original PDFs
- Audit trail for compliance (prove what was uploaded)
- Recovery from failed processing without re-upload

**Trade-offs**:
- Adds complexity: S3 bucket management, IAM policies, file path tracking
- Increases costs: S3 storage + data transfer
- Requires additional schema: `file_path` field in `books` table
- More code: AWS SDK integration, upload/download endpoints

**When to add**: Only if you need document re-processing, compliance/audit requirements, or admin downloads.

### Other Future Features
- Real-time collaboration on chat threads
- Advanced analytics dashboard (usage metrics, popular questions, citation tracking)
- Mobile native apps (iOS/Android)
- Enhanced admin portal (user management, role assignment, content approval workflows)
- Integration with learning management systems (Canvas, Blackboard, etc.)
- Export chat history to PDF/CSV
- Question suggestions/autocomplete
- Multi-language support

## 11. Design Decisions

1. **Vector DB Selection**: ✅ pgvector (single database, simpler ops)
2. **Citation Format**: ✅ Inline format: "(Book Title, p. XX)"
3. **Topic System**: ✅ System-wide topics (not user-specific), created during upload
4. **Chunk Overlap**: ✅ 200 tokens overlap (industry standard)
5. **Similarity Threshold**: ✅ Start with ~0.5-0.6 cosine similarity, tune during testing
6. **PDF Title Input**: ✅ Manual entry (auto-detection is out of scope)

### Open Questions
1. **Content Moderation**: Any filtering needed for uploaded PDFs or user queries?
2. **Similarity Threshold Tuning**: Final value to be determined during testing

## 12. Success Criteria

- Demo successfully shows knowledge acquisition (before/after upload)
- Answers cite correct book and page number in >90% of cases using inline format: "(Book Title, p. XX)"
- Topic filtering works (questions in "High School Math" topic don't pull from "Elementary Science" topic)
- "All Topics" chat searches across entire vector DB without topic filtering
- Chat history persists per topic across sessions
- **Strict knowledge boundary**: System NEVER uses LLM training data, only responds from uploaded materials
- **No hallucinations**: If answer not found in vector DB, system responds "I don't have a reference in our PLC docs that answers that question."
- Knowledge boundary test: Ask questions outside uploaded content (e.g., "what is 2+2?") → system correctly refuses to answer from training data

---

## 13. Development Phases

### Phase 1: Infrastructure & Authentication
- Set up AWS infrastructure (App Runner, RDS with pgvector, CloudFront + S3)
- Implement database schema (users, topics, books, messages, document_chunks)
- Configure pgvector extension with HNSW indexing
- Build Google OAuth authentication with role-based access control

### Phase 2: Chat Interface & RAG (Empty State)
- Build "All Topics" chat UI with empty state
- Implement RAG query system with strict knowledge boundary
- Connect to OpenAI API with prompt engineering
- Test knowledge boundary (should refuse all questions when DB is empty)
- Display inline citations format
- Persist chat history per topic

### Phase 3: PDF Ingestion Pipeline
- Build admin upload UI (file input, title input, topic selection/creation)
- Implement PDF processing (extract text, chunk with page tracking, embed, store)
- Tag chunks with topic_id during ingestion
- Show processing status and book management
- Test chunking quality and page number accuracy

### Phase 4: Multi-Topic Chat Interface
- Build topic sidebar showing all system-wide topics
- Enable topic filtering in vector search
- Support topic-specific chats with separate histories
- Maintain "All Topics" chat for cross-topic queries
- Test topic filtering accuracy
- Load test data and run full demo flow
