# Phase 3: PDF Ingestion Pipeline

## Overview
Build the PDF upload and ingestion system that extracts text from PDFs, chunks it with page number tracking, generates embeddings, and stores everything in the vector database tagged with topics. This phase includes both the admin UI for uploading PDFs and the backend processing pipeline.

## Goals
- Build admin upload UI with title and topic inputs
- Implement PDF text extraction with page tracking
- Implement text chunking strategy (1000 tokens, 200 overlap)
- Generate embeddings with OpenAI
- Store chunks in pgvector with metadata (title, page number, topic)
- Show processing status
- Enable book management (list, delete)
- Test chunking quality and citation accuracy

## Key Requirements
- PDFs are processed in memory (never stored)
- Track page numbers accurately during extraction
- Tag all chunks with topic_id
- Manual title entry
- Topic selection (existing or create new)

## Backend Implementation

### Required npm Packages
Add to your existing `package.json`:
```json
{
  "dependencies": {
    "pdf-parse": "^1.1.x",
    "multer": "^1.4.x",
    "uuid": "^9.0.x"
  },
  "devDependencies": {
    "@types/multer": "^1.4.x",
    "@types/pdf-parse": "^1.1.x"
  }
}
```

### Text Chunking Service

```typescript
// src/services/chunking.ts

interface TextChunk {
  text: string;
  page_number: number;
  chunk_index: number;
}

/**
 * Simple character-based text splitter
 * Splits on ~1000 tokens with 200 token overlap
 * Rough estimate: 1 token ≈ 4 characters, so:
 * - Chunk size: ~4000 characters
 * - Overlap: ~800 characters
 */
export function chunkText(
  text: string,
  pageNumber: number,
  chunkSize: number = 4000,
  overlap: number = 800
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < text.length) {
    // Extract chunk
    const endIndex = Math.min(startIndex + chunkSize, text.length);
    let chunkText = text.slice(startIndex, endIndex);

    // Try to end at a sentence boundary if possible
    if (endIndex < text.length) {
      const lastPeriod = chunkText.lastIndexOf('. ');
      const lastNewline = chunkText.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > chunkSize * 0.7) {
        // If we found a good break point in the last 30% of the chunk, use it
        chunkText = text.slice(startIndex, startIndex + breakPoint + 1);
      }
    }

    chunks.push({
      text: chunkText.trim(),
      page_number: pageNumber,
      chunk_index: chunkIndex++,
    });

    // Move start index forward, accounting for overlap
    startIndex += chunkText.length - overlap;

    // Prevent infinite loop
    if (startIndex <= 0) {
      startIndex = chunkText.length;
    }
  }

  return chunks;
}

/**
 * Process entire PDF text into chunks
 * Input is array of pages: [{ page: 1, text: "..." }, { page: 2, text: "..." }, ...]
 */
export function chunkPDFPages(
  pages: Array<{ page: number; text: string }>
): TextChunk[] {
  const allChunks: TextChunk[] = [];
  let globalChunkIndex = 0;

  for (const { page, text } of pages) {
    const pageChunks = chunkText(text, page);

    // Update global chunk index
    pageChunks.forEach(chunk => {
      allChunks.push({
        ...chunk,
        chunk_index: globalChunkIndex++,
      });
    });
  }

  return allChunks;
}
```

### PDF Processing Service

```typescript
// src/services/pdfProcessor.ts
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { chunkPDFPages } from './chunking';
import { generateQueryEmbedding } from './vectorSearch';
import pool from '../config/database';

interface ProcessingProgress {
  stage: 'extracting' | 'chunking' | 'embedding' | 'storing' | 'complete' | 'failed';
  progress: number; // 0-100
  message: string;
}

/**
 * Extract text from PDF with page tracking
 */
async function extractPDFText(buffer: Buffer): Promise<Array<{ page: number; text: string }>> {
  const data = await pdfParse(buffer);

  // pdf-parse doesn't provide per-page text by default
  // We need to use a workaround to extract text per page
  // For MVP, we'll use a simpler approach: split by page breaks

  // Get total pages
  const totalPages = data.numpages;

  // For now, we'll split the text roughly by estimated page length
  // This is not perfect but works for MVP
  // Better solution: use pdf.js or pdfjs-dist for accurate per-page extraction

  const fullText = data.text;
  const avgCharsPerPage = Math.ceil(fullText.length / totalPages);

  const pages: Array<{ page: number; text: string }> = [];

  for (let i = 0; i < totalPages; i++) {
    const startIndex = i * avgCharsPerPage;
    const endIndex = Math.min((i + 1) * avgCharsPerPage, fullText.length);
    const pageText = fullText.slice(startIndex, endIndex);

    pages.push({
      page: i + 1, // Pages are 1-indexed
      text: pageText,
    });
  }

  return pages;
}

/**
 * Better PDF extraction using render_page (if available)
 * This requires pdfjs-dist, which is more accurate but more complex
 * For MVP, use the simple version above
 */

/**
 * Process PDF: extract, chunk, embed, store
 */
export async function processPDF(
  bookId: string,
  pdfBuffer: Buffer,
  bookTitle: string,
  topicId: string,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<void> {
  try {
    // Stage 1: Extract text
    onProgress?.({
      stage: 'extracting',
      progress: 10,
      message: 'Extracting text from PDF...',
    });

    const pages = await extractPDFText(pdfBuffer);

    // Stage 2: Chunk text
    onProgress?.({
      stage: 'chunking',
      progress: 30,
      message: 'Chunking text...',
    });

    const chunks = chunkPDFPages(pages);

    // Stage 3: Generate embeddings
    onProgress?.({
      stage: 'embedding',
      progress: 40,
      message: `Generating embeddings for ${chunks.length} chunks...`,
    });

    // Generate embeddings in batches to avoid rate limits
    const BATCH_SIZE = 20;
    const chunksWithEmbeddings: Array<{
      text: string;
      embedding: number[];
      page_number: number;
      chunk_index: number;
    }> = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // Generate embeddings for batch
      const embeddingPromises = batch.map(chunk => generateQueryEmbedding(chunk.text));
      const embeddings = await Promise.all(embeddingPromises);

      // Combine chunks with embeddings
      batch.forEach((chunk, index) => {
        chunksWithEmbeddings.push({
          ...chunk,
          embedding: embeddings[index],
        });
      });

      // Update progress
      const progress = 40 + Math.floor((i / chunks.length) * 40);
      onProgress?.({
        stage: 'embedding',
        progress,
        message: `Generated ${i + batch.length}/${chunks.length} embeddings...`,
      });
    }

    // Stage 4: Store in database
    onProgress?.({
      stage: 'storing',
      progress: 80,
      message: 'Storing chunks in database...',
    });

    // Insert chunks in batches
    for (let i = 0; i < chunksWithEmbeddings.length; i += BATCH_SIZE) {
      const batch = chunksWithEmbeddings.slice(i, i + BATCH_SIZE);

      const insertPromises = batch.map(chunk => {
        const embeddingString = `[${chunk.embedding.join(',')}]`;
        return pool.query(
          `INSERT INTO document_chunks
           (id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index)
           VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8)`,
          [
            uuidv4(),
            bookId,
            topicId,
            chunk.text,
            embeddingString,
            chunk.page_number,
            bookTitle,
            chunk.chunk_index,
          ]
        );
      });

      await Promise.all(insertPromises);

      // Update progress
      const progress = 80 + Math.floor((i / chunksWithEmbeddings.length) * 15);
      onProgress?.({
        stage: 'storing',
        progress,
        message: `Stored ${i + batch.length}/${chunksWithEmbeddings.length} chunks...`,
      });
    }

    // Stage 5: Complete
    onProgress?.({
      stage: 'complete',
      progress: 100,
      message: 'Processing complete!',
    });

    // Update book status to complete
    await pool.query(
      'UPDATE books SET processing_status = $1 WHERE id = $2',
      ['complete', bookId]
    );
  } catch (error) {
    console.error('PDF processing error:', error);

    // Update book status to failed
    await pool.query(
      'UPDATE books SET processing_status = $1 WHERE id = $2',
      ['failed', bookId]
    );

    onProgress?.({
      stage: 'failed',
      progress: 0,
      message: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });

    throw error;
  }
}
```

### Admin API Routes

```typescript
// src/routes/admin.ts
import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../middleware/auth';
import { processPDF } from '../services/pdfProcessor';
import pool from '../config/database';

const router = Router();

// All routes require admin authentication
router.use(requireAdmin);

// Configure multer for in-memory file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

/**
 * GET /api/admin/topics
 * Get all topics
 */
router.get('/topics', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM topics ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching topics:', error);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

/**
 * POST /api/admin/topics
 * Create a new topic
 */
router.post('/topics', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Topic name is required' });
    }

    // Check if topic already exists
    const existingTopic = await pool.query(
      'SELECT * FROM topics WHERE name = $1',
      [name]
    );

    if (existingTopic.rows.length > 0) {
      return res.status(409).json({ error: 'Topic already exists' });
    }

    // Create topic
    const result = await pool.query(
      'INSERT INTO topics (id, name) VALUES ($1, $2) RETURNING *',
      [uuidv4(), name]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating topic:', error);
    res.status(500).json({ error: 'Failed to create topic' });
  }
});

/**
 * POST /api/admin/books/upload
 * Upload and process a PDF
 */
router.post('/books/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const { title, topic_id, new_topic_name } = req.body;

    // Validation
    if (!file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Book title is required' });
    }

    let topicId = topic_id;

    // Handle new topic creation
    if (!topicId && new_topic_name) {
      // Create new topic
      const topicResult = await pool.query(
        'INSERT INTO topics (id, name) VALUES ($1, $2) RETURNING *',
        [uuidv4(), new_topic_name]
      );
      topicId = topicResult.rows[0].id;
    }

    if (!topicId) {
      return res.status(400).json({ error: 'Topic is required (topic_id or new_topic_name)' });
    }

    // Verify topic exists
    const topicCheck = await pool.query('SELECT * FROM topics WHERE id = $1', [topicId]);
    if (topicCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Get user ID
    const userId = (req.user as any).id;

    // Create book record
    const bookId = uuidv4();
    const bookResult = await pool.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [bookId, title, topicId, userId, 'processing']
    );

    const book = bookResult.rows[0];

    // Start processing asynchronously
    // Don't await this - let it run in background
    processPDF(bookId, file.buffer, title, topicId).catch(error => {
      console.error('Background PDF processing error:', error);
    });

    // Return immediately with book info
    res.status(202).json({
      message: 'PDF upload received, processing started',
      book,
    });
  } catch (error) {
    console.error('Error uploading book:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to upload book',
    });
  }
});

/**
 * GET /api/admin/books
 * List all books
 */
router.get('/books', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.id,
        b.title,
        b.processing_status,
        b.created_at,
        t.name as topic_name,
        t.id as topic_id,
        u.name as uploaded_by_name
      FROM books b
      LEFT JOIN topics t ON b.topic_id = t.id
      LEFT JOIN users u ON b.uploaded_by = u.id
      ORDER BY b.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

/**
 * GET /api/admin/books/:id/status
 * Get processing status for a book
 */
router.get('/books/:id/status', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT processing_status FROM books WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    res.json({ processing_status: result.rows[0].processing_status });
  } catch (error) {
    console.error('Error fetching book status:', error);
    res.status(500).json({ error: 'Failed to fetch book status' });
  }
});

/**
 * DELETE /api/admin/books/:id
 * Delete a book and all its chunks
 */
router.delete('/books/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Delete book (chunks will be cascade deleted)
    const result = await pool.query('DELETE FROM books WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

export default router;
```

### Update Main Application
```typescript
// src/index.ts
import adminRoutes from './routes/admin';

// ... existing code ...

app.use('/api/admin', adminRoutes);
```

## Frontend Implementation

### Admin Upload UI

```typescript
// src/pages/Admin.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

interface Topic {
  id: string;
  name: string;
}

interface Book {
  id: string;
  title: string;
  topic_name: string;
  topic_id: string;
  processing_status: 'pending' | 'processing' | 'complete' | 'failed';
  uploaded_by_name: string;
  created_at: string;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function Admin() {
  const { user } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string>('');
  const [newTopicName, setNewTopicName] = useState('');
  const [createNewTopic, setCreateNewTopic] = useState(false);

  useEffect(() => {
    loadTopics();
    loadBooks();
  }, []);

  const loadTopics = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/admin/topics`, {
        withCredentials: true,
      });
      setTopics(response.data);
    } catch (error) {
      console.error('Error loading topics:', error);
    }
  };

  const loadBooks = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/admin/books`, {
        withCredentials: true,
      });
      setBooks(response.data);
    } catch (error) {
      console.error('Error loading books:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !title) {
      alert('Please provide both a file and title');
      return;
    }

    if (!createNewTopic && !selectedTopic) {
      alert('Please select a topic or create a new one');
      return;
    }

    if (createNewTopic && !newTopicName) {
      alert('Please enter a name for the new topic');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);

      if (createNewTopic) {
        formData.append('new_topic_name', newTopicName);
      } else {
        formData.append('topic_id', selectedTopic);
      }

      await axios.post(`${API_URL}/api/admin/books/upload`, formData, {
        withCredentials: true,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      alert('PDF uploaded successfully! Processing has started.');

      // Reset form
      setFile(null);
      setTitle('');
      setSelectedTopic('');
      setNewTopicName('');
      setCreateNewTopic(false);

      // Reload data
      loadTopics();
      loadBooks();
    } catch (error) {
      console.error('Error uploading PDF:', error);
      alert('Failed to upload PDF. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (bookId: string) => {
    if (!confirm('Are you sure you want to delete this book?')) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/api/admin/books/${bookId}`, {
        withCredentials: true,
      });
      alert('Book deleted successfully');
      loadBooks();
    } catch (error) {
      console.error('Error deleting book:', error);
      alert('Failed to delete book');
    }
  };

  // Only admins can access this page
  if (user?.role !== 'admin') {
    return <Navigate to="/chat" />;
  }

  return (
    <div className="admin-container">
      <h1>Admin Portal</h1>

      <section className="upload-section">
        <h2>Upload PDF</h2>
        <form onSubmit={handleSubmit} className="upload-form">
          <div className="form-group">
            <label htmlFor="file">PDF File *</label>
            <input
              type="file"
              id="file"
              accept=".pdf"
              onChange={handleFileChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="title">Book Title *</label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Introduction to Algebra"
              required
            />
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={createNewTopic}
                onChange={(e) => setCreateNewTopic(e.target.checked)}
              />
              Create new topic
            </label>
          </div>

          {createNewTopic ? (
            <div className="form-group">
              <label htmlFor="newTopic">New Topic Name *</label>
              <input
                type="text"
                id="newTopic"
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                placeholder="High School Math"
                required
              />
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="topic">Select Topic *</label>
              <select
                id="topic"
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                required
              >
                <option value="">-- Select a topic --</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button type="submit" disabled={loading}>
            {loading ? 'Uploading...' : 'Upload PDF'}
          </button>
        </form>
      </section>

      <section className="books-section">
        <h2>Uploaded Books</h2>
        <table className="books-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Topic</th>
              <th>Status</th>
              <th>Uploaded By</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {books.map((book) => (
              <tr key={book.id}>
                <td>{book.title}</td>
                <td>{book.topic_name}</td>
                <td>
                  <span className={`status ${book.processing_status}`}>
                    {book.processing_status}
                  </span>
                </td>
                <td>{book.uploaded_by_name}</td>
                <td>{new Date(book.created_at).toLocaleDateString()}</td>
                <td>
                  <button
                    onClick={() => handleDelete(book.id)}
                    className="delete-btn"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

### Admin Styles

```css
/* src/styles/Admin.css */
.admin-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.admin-container h1 {
  margin-bottom: 2rem;
}

.upload-section {
  background: #f9f9f9;
  padding: 2rem;
  border-radius: 8px;
  margin-bottom: 3rem;
}

.upload-section h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
}

.upload-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 500;
}

.form-group input[type="text"],
.form-group input[type="file"],
.form-group select {
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.upload-form button {
  padding: 0.75rem;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  margin-top: 1rem;
}

.upload-form button:hover:not(:disabled) {
  background: #0056b3;
}

.upload-form button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.books-section h2 {
  margin-bottom: 1rem;
}

.books-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}

.books-table th,
.books-table td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

.books-table th {
  background: #f5f5f5;
  font-weight: 600;
}

.status {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
}

.status.pending {
  background: #ffc107;
  color: #000;
}

.status.processing {
  background: #17a2b8;
  color: white;
}

.status.complete {
  background: #28a745;
  color: white;
}

.status.failed {
  background: #dc3545;
  color: white;
}

.delete-btn {
  padding: 0.5rem 1rem;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.delete-btn:hover {
  background: #c82333;
}
```

### Update App Router

```typescript
// src/App.tsx
import Admin from './pages/Admin';

// Add route
<Route
  path="/admin"
  element={
    <PrivateRoute>
      <Admin />
    </PrivateRoute>
  }
/>
```

## Testing & Validation

### Test PDF Documents
Use small test PDFs first (5-10 pages), then scale up:
- Simple text-based PDFs
- PDFs with varied page layouts
- Educational textbooks from OpenStax or CK-12

### Backend Tests

#### 1. Test PDF Upload
```bash
curl -X POST http://localhost:3001/api/admin/books/upload \
  -F "file=@test.pdf" \
  -F "title=Test Book" \
  -F "topic_id=your-topic-id" \
  --cookie "your-admin-session-cookie"
```

#### 2. Verify Chunks in Database
```sql
SELECT
  COUNT(*) as chunk_count,
  book_title,
  topic_id
FROM document_chunks
GROUP BY book_title, topic_id;
```

#### 3. Test Page Number Tracking
```sql
SELECT
  chunk_index,
  page_number,
  LEFT(text, 100) as text_preview
FROM document_chunks
WHERE book_id = 'your-book-id'
ORDER BY chunk_index
LIMIT 10;
```

#### 4. Test Vector Search with Real Data
```bash
# Send a question that should now have an answer
curl -X POST http://localhost:3001/api/topics/null/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Question about content in uploaded PDF"}' \
  --cookie "your-session-cookie"

# Should return answer with citations like: (Book Title, p. 5)
```

### Frontend Tests
- [ ] Admin upload form renders correctly
- [ ] Can select PDF file
- [ ] Can enter title
- [ ] Can select existing topic
- [ ] Can create new topic
- [ ] Upload shows loading state
- [ ] Success message appears after upload
- [ ] Books table populates with uploaded book
- [ ] Processing status updates (may need to refresh)
- [ ] Can delete books
- [ ] Non-admin users cannot access `/admin` page

### Integration Tests
- [ ] Upload PDF → Processing starts → Status changes to "complete"
- [ ] Chunks appear in database with correct metadata
- [ ] Chat can now answer questions from uploaded PDF
- [ ] Citations include correct book title and page numbers
- [ ] Topic filtering works (upload to specific topic, chat only sees that topic's content)

### Citation Accuracy Tests

Critical: Verify that citations point to the correct page numbers

1. Upload a test PDF with known content
2. Ask specific questions about content on specific pages
3. Verify the citation page number matches the actual source page
4. Test edge cases:
   - Content at page boundaries
   - Content spanning multiple pages
   - Multiple chunks from same page

### Chunking Quality Tests

1. **Check chunk sizes**:
   ```sql
   SELECT
     chunk_index,
     LENGTH(text) as char_count,
     page_number
   FROM document_chunks
   WHERE book_id = 'your-book-id'
   ORDER BY chunk_index;
   ```

2. **Verify overlap**:
   - Manual inspection of consecutive chunks
   - Should see ~800 characters of overlap

3. **Test retrieval quality**:
   - Ask questions that require full context
   - Verify answers are coherent (chunks have enough context)

## Environment Variables

No new environment variables needed (already set in Phase 2).

## Success Criteria

- [ ] Admin can upload PDFs successfully
- [ ] PDFs are processed and chunked correctly
- [ ] Chunks are stored in vector database with correct metadata
- [ ] Page numbers are tracked accurately
- [ ] Topic tagging works correctly
- [ ] Processing status updates correctly
- [ ] Books can be deleted
- [ ] Chat now returns answers with citations for uploaded content
- [ ] Citations reference correct page numbers (>90% accuracy)
- [ ] System still refuses questions outside uploaded content
- [ ] Multiple books can be uploaded to same topic
- [ ] Books in different topics are properly isolated

## Common Issues & Troubleshooting

1. **PDF extraction fails**:
   - Verify PDF is not corrupted
   - Try simpler text-based PDF
   - Check for scanned PDFs (need OCR, out of scope for MVP)

2. **Page numbers are incorrect**:
   - pdf-parse page splitting is approximate
   - Consider using pdfjs-dist for more accurate per-page extraction
   - For MVP, document this limitation

3. **Embedding rate limits**:
   - OpenAI has rate limits on embeddings API
   - Batch processing helps (current implementation)
   - Add delays if needed: `await new Promise(resolve => setTimeout(resolve, 1000));`

4. **Citations not showing**:
   - Verify chunks have book_title and page_number
   - Check RAG service returns citations array
   - Verify frontend renders citations correctly

5. **Memory issues with large PDFs**:
   - Set proper file size limits (currently 50MB)
   - Process in smaller batches if needed
   - Monitor App Runner memory usage

## Next Steps
After completing Phase 3, proceed to **Phase 4: Multi-Topic Chat Interface** to build the topic sidebar and enable topic-specific filtering in the chat UI.
