import { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth';
import pool from '../config/database';
import { uploadPDF, deleteBook } from '../services/pdfProcessor';
import { uploadAndProcessBook } from '../services/bookProcessorNew';

const router = Router();

// All routes require admin authentication
router.use(requireAdmin);

// Configure multer for memory storage (don't save files to disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 400 * 1024 * 1024 // 400MB limit (for large textbooks)
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

/**
 * POST /api/admin/topics
 * Create a new topic or return existing one by name
 */
router.post('/topics', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Topic name is required' });
    }

    const trimmedName = name.trim();

    // Check if topic already exists
    const existingTopic = await pool.query(
      'SELECT id, name FROM topics WHERE LOWER(name) = LOWER($1)',
      [trimmedName]
    );

    if (existingTopic.rows.length > 0) {
      return res.json(existingTopic.rows[0]);
    }

    // Create new topic
    const result = await pool.query(
      'INSERT INTO topics (id, name) VALUES (gen_random_uuid(), $1) RETURNING id, name',
      [trimmedName]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating topic:', error);
    res.status(500).json({ error: 'Failed to create topic' });
  }
});

/**
 * GET /api/admin/books
 * List all books with topic names and uploader info
 */
router.get('/books', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.id,
        b.title,
        b.processing_status,
        b.error_message,
        b.created_at,
        t.name as topic_name,
        t.id as topic_id,
        u.name as uploaded_by_name,
        u.email as uploaded_by_email
      FROM books b
      JOIN topics t ON b.topic_id = t.id
      JOIN users u ON b.uploaded_by = u.id
      ORDER BY b.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

/**
 * POST /api/admin/books/upload
 * Upload and process a PDF
 */
router.post('/books/upload', upload.single('pdf'), async (req, res) => {
  try {
    // Validate file
    if (!req.file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    // Validate request body
    const { title, topicId } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!topicId || typeof topicId !== 'string') {
      return res.status(400).json({ error: 'Topic ID is required' });
    }

    // Verify topic exists
    const topicResult = await pool.query(
      'SELECT id FROM topics WHERE id = $1',
      [topicId]
    );

    if (topicResult.rows.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Get user ID from session
    const userId = (req.user as any).id;

    // Upload the PDF and process it
    console.log(`Uploading PDF: ${title} (${req.file.size} bytes)`);

    const { bookId, jobId } = await uploadAndProcessBook(
      req.file.buffer,
      title.trim(),
      topicId,
      userId
    );

    res.json({
      success: true,
      bookId,
      jobId,
      message: `PDF uploaded and processed successfully!`
    });
  } catch (error) {
    console.error('Error uploading PDF:', error);

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size exceeds 400MB limit' });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to upload PDF'
    });
  }
});

/**
 * DELETE /api/admin/books/:id
 * Delete a book and all its chunks
 */
router.delete('/books/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if book exists
    const bookResult = await pool.query(
      'SELECT id, processing_status FROM books WHERE id = $1',
      [id]
    );

    if (bookResult.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const book = bookResult.rows[0];

    // Log a warning if deleting a processing book, but allow it
    // (useful for stuck jobs or manual cleanup)
    if (book.processing_status === 'processing') {
      console.warn(`Deleting book ${id} while in 'processing' status - background job may fail gracefully`);
    }

    // Delete the book (cascades to chunks, jobs, etc. via foreign keys)
    await deleteBook(id);

    res.json({ success: true, message: 'Book deleted successfully' });
  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

export default router;
