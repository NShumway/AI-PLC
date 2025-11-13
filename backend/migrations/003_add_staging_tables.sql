-- Migration: Add staging tables for atomic PDF processing
-- This allows us to process PDFs in chunks and commit atomically

-- Job tracking table
CREATE TABLE IF NOT EXISTS book_processing_jobs (
  id UUID PRIMARY KEY,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  total_chunks INTEGER NOT NULL,
  completed_chunks INTEGER DEFAULT 0,
  failed_chunks INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'processing', -- 'processing', 'committing', 'complete', 'failed'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Staging table for document chunks (not visible to queries yet)
CREATE TABLE IF NOT EXISTS document_chunks_staging (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES book_processing_jobs(id) ON DELETE CASCADE,
  book_id UUID NOT NULL,
  topic_id UUID,
  text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  book_title VARCHAR(500) NOT NULL,
  chunk_index INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for staging table
CREATE INDEX IF NOT EXISTS idx_staging_job_id ON document_chunks_staging(job_id);
CREATE INDEX IF NOT EXISTS idx_staging_book_id ON document_chunks_staging(book_id);

-- Add index for job tracking
CREATE INDEX IF NOT EXISTS idx_jobs_book_id ON book_processing_jobs(book_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON book_processing_jobs(status);

-- Ensure document_chunks has proper constraints
ALTER TABLE document_chunks
  ALTER COLUMN page_number SET NOT NULL,
  ALTER COLUMN book_title SET NOT NULL;

-- Add check constraint if not exists (postgres syntax)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_chunks_page_number_check'
  ) THEN
    ALTER TABLE document_chunks ADD CONSTRAINT document_chunks_page_number_check CHECK (page_number > 0);
  END IF;
END $$;
