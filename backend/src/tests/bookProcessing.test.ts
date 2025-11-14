import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import pool from '../config/database';
import { v4 as uuidv4 } from 'uuid';

describe('Database Staging and Atomic Commits', () => {
  let testTopicId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Create test topic
    const topicResult = await pool.query(
      'INSERT INTO topics (id, name) VALUES ($1, $2) RETURNING id',
      [uuidv4(), 'Test Topic for PDF Processing']
    );
    testTopicId = topicResult.rows[0].id;

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (id, google_id, email, name, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [uuidv4(), 'test-google-id-123', 'test@example.com', 'Test User', 'educator']
    );
    testUserId = userResult.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM users WHERE email = $1', ['test@example.com']);
    await pool.query('DELETE FROM topics WHERE name = $1', ['Test Topic for PDF Processing']);
  });

  test('staging tables should exist', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('book_processing_jobs', 'document_chunks_staging')
    `);

    expect(result.rows.length).toBe(2);
    const tableNames = result.rows.map(r => r.table_name);
    expect(tableNames).toContain('book_processing_jobs');
    expect(tableNames).toContain('document_chunks_staging');
  });

  test('should create book processing job', async () => {
    const bookId = uuidv4();
    const jobId = uuidv4();

    // Create book
    await pool.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [bookId, 'Test Book', testTopicId, testUserId, 'processing']
    );

    // Create job
    await pool.query(
      `INSERT INTO book_processing_jobs (id, book_id, total_chunks, status)
       VALUES ($1, $2, $3, 'processing')`,
      [jobId, bookId, 3]
    );

    const result = await pool.query(
      'SELECT * FROM book_processing_jobs WHERE id = $1',
      [jobId]
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].book_id).toBe(bookId);
    expect(result.rows[0].total_chunks).toBe(3);
    expect(result.rows[0].completed_chunks).toBe(0);
    expect(result.rows[0].status).toBe('processing');

    // Cleanup
    await pool.query('DELETE FROM book_processing_jobs WHERE id = $1', [jobId]);
    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
  });

  test('should insert chunks to staging table', async () => {
    const bookId = uuidv4();
    const jobId = uuidv4();

    await pool.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [bookId, 'Test Book', testTopicId, testUserId, 'processing']
    );

    await pool.query(
      `INSERT INTO book_processing_jobs (id, book_id, total_chunks)
       VALUES ($1, $2, $3)`,
      [jobId, bookId, 1]
    );

    // Insert staging chunk
    const chunkId = uuidv4();
    const embedding = Array(1536).fill(0.1);

    await pool.query(
      `INSERT INTO document_chunks_staging
       (id, job_id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [chunkId, jobId, bookId, testTopicId, 'Test chunk text', `[${embedding.join(',')}]`, 1, 'Test Book', 0]
    );

    const result = await pool.query(
      'SELECT * FROM document_chunks_staging WHERE job_id = $1',
      [jobId]
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].text).toBe('Test chunk text');
    expect(result.rows[0].page_number).toBe(1);
    expect(result.rows[0].book_title).toBe('Test Book');

    // Cleanup
    await pool.query('DELETE FROM document_chunks_staging WHERE job_id = $1', [jobId]);
    await pool.query('DELETE FROM book_processing_jobs WHERE id = $1', [jobId]);
    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
  });

  test('should enforce NOT NULL constraints on page_number and book_title', async () => {
    const bookId = uuidv4();
    const jobId = uuidv4();

    await pool.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [bookId, 'Test Book', testTopicId, testUserId, 'processing']
    );

    await pool.query(
      `INSERT INTO book_processing_jobs (id, book_id, total_chunks)
       VALUES ($1, $2, $3)`,
      [jobId, bookId, 1]
    );

    const embedding = Array(1536).fill(0.1);

    // Try to insert without page_number (should fail)
    await expect(
      pool.query(
        `INSERT INTO document_chunks_staging
         (id, job_id, book_id, topic_id, text, embedding, book_title, chunk_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uuidv4(), jobId, bookId, testTopicId, 'Test', `[${embedding.join(',')}]`, 'Test Book', 0]
      )
    ).rejects.toThrow();

    // Try to insert without book_title (should fail)
    await expect(
      pool.query(
        `INSERT INTO document_chunks_staging
         (id, job_id, book_id, topic_id, text, embedding, page_number, chunk_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uuidv4(), jobId, bookId, testTopicId, 'Test', `[${embedding.join(',')}]`, 1, 0]
      )
    ).rejects.toThrow();

    // Cleanup
    await pool.query('DELETE FROM book_processing_jobs WHERE id = $1', [jobId]);
    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
  });

  test('should commit staging chunks to production atomically', async () => {
    const bookId = uuidv4();
    const jobId = uuidv4();

    await pool.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [bookId, 'Test Book', testTopicId, testUserId, 'processing']
    );

    await pool.query(
      `INSERT INTO book_processing_jobs (id, book_id, total_chunks)
       VALUES ($1, $2, $3)`,
      [jobId, bookId, 1]
    );

    // Insert multiple chunks to staging
    const embedding = Array(1536).fill(0.1);
    const chunkIds = [uuidv4(), uuidv4(), uuidv4()];

    for (let i = 0; i < chunkIds.length; i++) {
      await pool.query(
        `INSERT INTO document_chunks_staging
         (id, job_id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [chunkIds[i], jobId, bookId, testTopicId, `Chunk ${i}`, `[${embedding.join(',')}]`, i + 1, 'Test Book', i]
      );
    }

    // Verify staging has 3 chunks
    const stagingResult = await pool.query(
      'SELECT COUNT(*) FROM document_chunks_staging WHERE job_id = $1',
      [jobId]
    );
    expect(parseInt(stagingResult.rows[0].count)).toBe(3);

    // Commit to production (atomic transaction)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO document_chunks
         (id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index, created_at)
         SELECT id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index, created_at
         FROM document_chunks_staging
         WHERE job_id = $1`,
        [jobId]
      );

      await client.query(
        'DELETE FROM document_chunks_staging WHERE job_id = $1',
        [jobId]
      );

      await client.query(
        `UPDATE books SET processing_status = 'complete' WHERE id = $1`,
        [bookId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Verify production has 3 chunks
    const productionResult = await pool.query(
      'SELECT COUNT(*) FROM document_chunks WHERE book_id = $1',
      [bookId]
    );
    expect(parseInt(productionResult.rows[0].count)).toBe(3);

    // Verify staging is empty
    const stagingAfter = await pool.query(
      'SELECT COUNT(*) FROM document_chunks_staging WHERE job_id = $1',
      [jobId]
    );
    expect(parseInt(stagingAfter.rows[0].count)).toBe(0);

    // Verify book status
    const bookResult = await pool.query(
      'SELECT processing_status FROM books WHERE id = $1',
      [bookId]
    );
    expect(bookResult.rows[0].processing_status).toBe('complete');

    // Cleanup
    await pool.query('DELETE FROM document_chunks WHERE book_id = $1', [bookId]);
    await pool.query('DELETE FROM book_processing_jobs WHERE id = $1', [jobId]);
    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
  });

  test('should rollback on failure (atomic guarantee)', async () => {
    const bookId = uuidv4();
    const jobId = uuidv4();

    await pool.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [bookId, 'Test Book', testTopicId, testUserId, 'processing']
    );

    await pool.query(
      `INSERT INTO book_processing_jobs (id, book_id, total_chunks)
       VALUES ($1, $2, $3)`,
      [jobId, bookId, 1]
    );

    const embedding = Array(1536).fill(0.1);
    await pool.query(
      `INSERT INTO document_chunks_staging
       (id, job_id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uuidv4(), jobId, bookId, testTopicId, 'Test chunk', `[${embedding.join(',')}]`, 1, 'Test Book', 0]
    );

    // Try to commit with an intentional error
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // This should succeed
      await client.query(
        `INSERT INTO document_chunks
         (id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index, created_at)
         SELECT id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index, created_at
         FROM document_chunks_staging
         WHERE job_id = $1`,
        [jobId]
      );

      // Force an error (invalid SQL)
      await client.query('SELECT * FROM nonexistent_table');

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      // Expected error
    } finally {
      client.release();
    }

    // Verify production has NO chunks (rollback worked)
    const productionResult = await pool.query(
      'SELECT COUNT(*) FROM document_chunks WHERE book_id = $1',
      [bookId]
    );
    expect(parseInt(productionResult.rows[0].count)).toBe(0);

    // Verify staging STILL has chunk (not deleted due to rollback)
    const stagingResult = await pool.query(
      'SELECT COUNT(*) FROM document_chunks_staging WHERE job_id = $1',
      [jobId]
    );
    expect(parseInt(stagingResult.rows[0].count)).toBe(1);

    // Cleanup
    await pool.query('DELETE FROM document_chunks_staging WHERE job_id = $1', [jobId]);
    await pool.query('DELETE FROM book_processing_jobs WHERE id = $1', [jobId]);
    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
  });

  test('should track worker completion progress', async () => {
    const bookId = uuidv4();
    const jobId = uuidv4();

    await pool.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [bookId, 'Test Book', testTopicId, testUserId, 'processing']
    );

    await pool.query(
      `INSERT INTO book_processing_jobs (id, book_id, total_chunks, completed_chunks)
       VALUES ($1, $2, $3, $4)`,
      [jobId, bookId, 3, 0]
    );

    // Simulate worker completions
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `UPDATE book_processing_jobs
         SET completed_chunks = completed_chunks + 1, updated_at = NOW()
         WHERE id = $1`,
        [jobId]
      );

      const result = await pool.query(
        'SELECT completed_chunks, total_chunks FROM book_processing_jobs WHERE id = $1',
        [jobId]
      );

      expect(result.rows[0].completed_chunks).toBe(i + 1);
    }

    const finalResult = await pool.query(
      'SELECT completed_chunks, total_chunks FROM book_processing_jobs WHERE id = $1',
      [jobId]
    );

    expect(finalResult.rows[0].completed_chunks).toBe(3);
    expect(finalResult.rows[0].total_chunks).toBe(3);

    // Cleanup
    await pool.query('DELETE FROM book_processing_jobs WHERE id = $1', [jobId]);
    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
  });
});
