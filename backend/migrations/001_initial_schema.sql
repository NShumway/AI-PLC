-- AI-Powered PLC Coach - Initial Database Schema
-- Run this migration on your PostgreSQL database

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'educator')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Topics table (system-wide categories for PDFs)
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topics_name ON topics(name);

-- Books table (PDF metadata)
CREATE TABLE IF NOT EXISTS books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  processing_status VARCHAR(20) NOT NULL CHECK (processing_status IN ('pending', 'processing', 'complete', 'failed')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_topic_id ON books(topic_id);
CREATE INDEX IF NOT EXISTS idx_books_uploaded_by ON books(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_books_processing_status ON books(processing_status);

-- Messages table (chat history, organized by topic)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE, -- NULL for "All Topics" chat
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB, -- Format: [{"book_title": "...", "page_number": 42}]
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_topic_id ON messages(topic_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Document chunks table (vector storage with pgvector)
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension
  page_number INTEGER NOT NULL,
  book_title VARCHAR(500) NOT NULL,
  chunk_index INTEGER NOT NULL, -- Order within the document (0-based)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- Create indexes for metadata filtering
CREATE INDEX IF NOT EXISTS idx_chunks_book_id ON document_chunks(book_id);
CREATE INDEX IF NOT EXISTS idx_chunks_topic_id ON document_chunks(topic_id);
CREATE INDEX IF NOT EXISTS idx_chunks_book_title ON document_chunks(book_title);

-- Session table for express-session (connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
) WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✓ Database schema created successfully!';
  RAISE NOTICE '✓ pgvector extension enabled';
  RAISE NOTICE '✓ All tables and indexes created';
END $$;
