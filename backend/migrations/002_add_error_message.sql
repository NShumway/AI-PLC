-- Migration: Add error_message column to books table
-- This column stores error details when PDF processing fails

ALTER TABLE books
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add index for querying failed books (skip if exists)
CREATE INDEX IF NOT EXISTS idx_books_processing_status ON books(processing_status);
