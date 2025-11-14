import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import pool from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';

const execFileAsync = promisify(execFile);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const PROCESSING_DIR = process.env.PROCESSING_DIR || '/tmp/processing';
const pageCache = new Map<string, string>();

interface TextChunk {
  text: string;
  pageNumber: number;
  chunkIndex: number;
  textLength: number;
}

/**
 * Extract a single page of text from PDF
 */
async function extractSinglePage(pdfPath: string, pageNum: number): Promise<string> {
  const cacheKey = `${pdfPath}:${pageNum}`;

  if (pageCache.has(cacheKey)) {
    return pageCache.get(cacheKey)!;
  }

  const tempOutput = `/tmp/extract-page-${Date.now()}-${pageNum}.txt`;

  try {
    await execFileAsync('pdftotext', [
      '-f', pageNum.toString(),
      '-l', pageNum.toString(),
      '-enc', 'UTF-8',
      pdfPath,
      tempOutput
    ]);

    const text = await fs.readFile(tempOutput, 'utf-8');
    const trimmedText = text.trim();

    pageCache.set(cacheKey, trimmedText);

    return trimmedText;

  } finally {
    await fs.unlink(tempOutput).catch(() => {});
  }
}

/**
 * Get total page count from PDF
 */
async function getPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
  const match = stdout.match(/Pages:\s+(\d+)/);

  if (!match) {
    throw new Error('Could not determine page count');
  }

  return parseInt(match[1], 10);
}

/**
 * Recursively peek ahead to get enough context for semantic continuity
 */
async function peekAhead(
  pdfPath: string,
  startPage: number,
  totalPages: number,
  targetChars: number = 2000
): Promise<string> {
  let accumulatedText = '';
  let currentPage = startPage;

  while (accumulatedText.length < targetChars && currentPage <= totalPages) {
    const pageText = await extractSinglePage(pdfPath, currentPage);

    if (!pageText) {
      currentPage++;
      continue;
    }

    const neededChars = targetChars - accumulatedText.length;
    const pageContribution = pageText.substring(0, neededChars);

    accumulatedText += (accumulatedText.length > 0 ? '\n\n' : '') + pageContribution;

    if (accumulatedText.length >= targetChars) {
      break;
    }

    if (pageText.length <= neededChars) {
      currentPage++;
    } else {
      break;
    }
  }

  return accumulatedText;
}

/**
 * Process a single page with lookahead
 */
async function processPage(
  pdfPath: string,
  pageNum: number,
  totalPages: number
): Promise<TextChunk[]> {
  const pageText = await extractSinglePage(pdfPath, pageNum);

  if (!pageText || pageText.length === 0) {
    return [];
  }

  const CHUNK_SIZE = 1000;
  const OVERLAP = 200;
  const LOOKAHEAD_TARGET = 2000;

  const chunks: TextChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < pageText.length) {
    const endIndex = Math.min(startIndex + CHUNK_SIZE, pageText.length);
    let chunkText = pageText.substring(startIndex, endIndex);

    const isLastChunk = (startIndex + CHUNK_SIZE >= pageText.length);

    if (isLastChunk && pageNum < totalPages) {
      const lookaheadText = await peekAhead(
        pdfPath,
        pageNum + 1,
        totalPages,
        LOOKAHEAD_TARGET
      );

      if (lookaheadText) {
        chunkText += '\n\n' + lookaheadText;
      }
    }

    if (chunkText.trim().length > 50) {
      chunks.push({
        text: chunkText.trim(),
        pageNumber: pageNum,
        chunkIndex: chunkIndex++,
        textLength: chunkText.trim().length
      });
    }

    startIndex += CHUNK_SIZE - OVERLAP;
  }

  return chunks;
}

/**
 * Generate embeddings in batches
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts
  });

  return response.data.map(item => item.embedding);
}

/**
 * Process a range of pages and insert into staging
 */
async function processPageRange(
  jobId: string,
  bookId: string,
  title: string,
  topicId: string,
  pdfPath: string,
  processStart: number,
  processEnd: number,
  totalPages: number
): Promise<void> {
  console.log(`Processing pages ${processStart}-${processEnd}...`);

  const client = await pool.connect();

  try {
    let totalChunks = 0;

    for (let pageNum = processStart; pageNum <= processEnd; pageNum++) {
      const chunks = await processPage(pdfPath, pageNum, totalPages);

      if (chunks.length === 0) {
        continue;
      }

      // Generate embeddings in batches of 50
      const EMBED_BATCH_SIZE = 50;
      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        const embeddings = await generateEmbeddings(batch.map(c => c.text));

        // Insert to staging
        await client.query('BEGIN');

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embedding = embeddings[j];

          await client.query(
            `INSERT INTO document_chunks_staging
             (id, job_id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              uuidv4(),
              jobId,
              bookId,
              topicId,
              chunk.text,
              `[${embedding.join(',')}]`,
              chunk.pageNumber,
              title,
              chunk.chunkIndex
            ]
          );
        }

        await client.query('COMMIT');
        totalChunks += batch.length;
      }

      if (pageNum % 50 === 0) {
        console.log(`  Processed page ${pageNum}/${processEnd} (${totalChunks} chunks so far)`);
      }
    }

    console.log(`Completed pages ${processStart}-${processEnd}: ${totalChunks} chunks`);

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Background processing function - handles the actual PDF processing
 */
async function processBookInBackground(
  jobId: string,
  bookId: string,
  title: string,
  topicId: string,
  pdfPath: string,
  totalPages: number
): Promise<void> {
  const client = await pool.connect();

  try {
    const WORKERS = 3;
    const pagesPerWorker = Math.ceil(totalPages / WORKERS);

    console.log(`\nStarting background processing with ${WORKERS} workers in parallel...`);

    // Create all worker promises to run in parallel
    const workerPromises = [];
    for (let i = 0; i < WORKERS; i++) {
      const processStart = i * pagesPerWorker + 1;
      const processEnd = Math.min((i + 1) * pagesPerWorker, totalPages);

      const workerPromise = processPageRange(
        jobId,
        bookId,
        title,
        topicId,
        pdfPath,
        processStart,
        processEnd,
        totalPages
      ).then(async () => {
        // Mark worker complete
        await client.query(
          `UPDATE book_processing_jobs
           SET completed_chunks = completed_chunks + 1,
               updated_at = NOW()
           WHERE id = $1`,
          [jobId]
        );
        console.log(`✓ Worker ${i + 1}/${WORKERS} completed pages ${processStart}-${processEnd}`);
      });

      workerPromises.push(workerPromise);
    }

    // Wait for all workers to complete in parallel
    await Promise.all(workerPromises);

    // All workers complete - commit to production
    console.log('\nAll workers complete. Committing to production...');
    await commitToProduction(jobId, bookId, pdfPath);

    console.log(`✓ Book ${bookId} processing complete!`);

  } catch (error) {
    console.error(`Error processing book ${bookId}:`, error);

    // Mark book and job as failed
    try {
      await client.query(
        `UPDATE books
         SET processing_status = 'failed',
             error_message = $1
         WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error occurred', bookId]
      );

      await client.query(
        `UPDATE book_processing_jobs
         SET status = 'failed',
             error_message = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error occurred', jobId]
      );

      // Clean up staging data
      await client.query(
        'DELETE FROM document_chunks_staging WHERE job_id = $1',
        [jobId]
      );

      // Try to delete PDF file
      await fs.unlink(pdfPath).catch(err =>
        console.warn(`Failed to delete ${pdfPath}:`, err.message)
      );

    } catch (updateError) {
      console.error(`Failed to mark book ${bookId} as failed:`, updateError);
    }
  } finally {
    client.release();
  }
}

/**
 * Upload and process a book (returns immediately, processes in background)
 */
export async function uploadAndProcessBook(
  pdfBuffer: Buffer,
  title: string,
  topicId: string,
  uploadedBy: string
): Promise<{ bookId: string; jobId: string }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create book record
    const bookId = uuidv4();
    await client.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [bookId, title, topicId, uploadedBy, 'processing']
    );

    // Store PDF
    await fs.mkdir(PROCESSING_DIR, { recursive: true });
    const pdfPath = `${PROCESSING_DIR}/${bookId}.pdf`;
    await fs.writeFile(pdfPath, pdfBuffer);

    // Get page count
    const totalPages = await getPageCount(pdfPath);
    console.log(`PDF uploaded: ${title} (${totalPages} pages)`);

    // Create job
    const jobId = uuidv4();
    const WORKERS = 3;

    await client.query(
      `INSERT INTO book_processing_jobs (id, book_id, total_chunks, status)
       VALUES ($1, $2, $3, 'processing')`,
      [jobId, bookId, WORKERS]
    );

    await client.query('COMMIT');

    // Kick off background processing (don't await!)
    processBookInBackground(jobId, bookId, title, topicId, pdfPath, totalPages)
      .catch(err => console.error(`Background processing failed for book ${bookId}:`, err));

    // Return immediately
    console.log(`✓ Book ${bookId} created, processing started in background`);
    return { bookId, jobId };

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Commit all staged chunks to production
 */
async function commitToProduction(
  jobId: string,
  bookId: string,
  pdfPath: string
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Move all staged chunks to production
    const result = await client.query(
      `INSERT INTO document_chunks
       (id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index, created_at)
       SELECT id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index, created_at
       FROM document_chunks_staging
       WHERE job_id = $1
       RETURNING id`,
      [jobId]
    );

    console.log(`✓ Committed ${result.rowCount} chunks to production`);

    // Delete staging data
    await client.query(
      'DELETE FROM document_chunks_staging WHERE job_id = $1',
      [jobId]
    );

    // Update book status
    await client.query(
      `UPDATE books
       SET processing_status = 'complete'
       WHERE id = $1`,
      [bookId]
    );

    // Update job status
    await client.query(
      `UPDATE book_processing_jobs
       SET status = 'complete', updated_at = NOW()
       WHERE id = $1`,
      [jobId]
    );

    await client.query('COMMIT');

    console.log('✓ Book processing complete!');

    // Cleanup PDF file
    await fs.unlink(pdfPath).catch(err =>
      console.warn(`Failed to delete ${pdfPath}:`, err.message)
    );

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Commit failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a book and all its chunks from the database
 */
export async function deleteBook(bookId: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete from PostgreSQL (cascades to document_chunks via FK)
    await client.query('DELETE FROM document_chunks WHERE book_id = $1', [bookId]);
    await client.query('DELETE FROM books WHERE id = $1', [bookId]);

    await client.query('COMMIT');

    console.log(`Successfully deleted book ${bookId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting book:', error);
    throw error;
  } finally {
    client.release();
  }
}
