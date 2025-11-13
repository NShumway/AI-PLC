/**
 * PDF Processing Service
 *
 * Orchestrates the full pipeline:
 * 1. Extract text from PDF page-by-page
 * 2. Chunk text with overlap
 * 3. Generate embeddings
 * 4. Store in PostgreSQL + ChromaDB
 */

import pdf from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { chunkPagedText, PageText } from './chunking';
import { addDocumentChunk, generateEmbedding } from './vectorSearch';

export interface ProcessingResult {
  success: boolean;
  bookId: string;
  chunksProcessed: number;
  error?: string;
}

export interface PDFUploadData {
  title: string;
  topicId: string;
  uploadedBy: string;
  buffer: Buffer;
}

/**
 * Extract text from PDF buffer page-by-page
 */
async function extractPagesFromPDF(buffer: Buffer): Promise<PageText[]> {
  try {
    // Parse the PDF
    const data = await pdf(buffer);

    // pdf-parse gives us the full text, but we need page-by-page
    // We'll use the numpages property and re-parse with render_page option
    const pages: PageText[] = [];

    // Custom render function to extract text page-by-page
    const renderPage = (pageData: any) => {
      return pageData.getTextContent().then((textContent: any) => {
        let lastY;
        let text = '';
        for (const item of textContent.items) {
          if (lastY === item.transform[5] || !lastY) {
            text += item.str;
          } else {
            text += '\n' + item.str;
          }
          lastY = item.transform[5];
        }
        return text;
      });
    };

    // Re-parse with custom render to get page-by-page text
    const dataWithPages = await pdf(buffer, { pagerender: renderPage });

    // If the custom render worked, we should have page text
    // Otherwise fall back to splitting the full text
    if (dataWithPages.numpages > 0) {
      // Split the full text by page (this is approximate)
      // Better approach: use pdf-parse's render capabilities
      const fullText = dataWithPages.text;
      const estimatedCharsPerPage = Math.ceil(fullText.length / dataWithPages.numpages);

      for (let i = 1; i <= dataWithPages.numpages; i++) {
        const startIdx = (i - 1) * estimatedCharsPerPage;
        const endIdx = i * estimatedCharsPerPage;
        const pageText = fullText.substring(startIdx, endIdx);

        if (pageText.trim().length > 0) {
          pages.push({
            pageNumber: i,
            text: pageText
          });
        }
      }
    }

    // If we didn't get any pages, just treat the whole document as one page
    if (pages.length === 0 && data.text.trim().length > 0) {
      pages.push({
        pageNumber: 1,
        text: data.text
      });
    }

    return pages;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error(`PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Process a PDF: extract, chunk, embed, and store
 * Optimized for large files - processes pages in batches to avoid OOM
 */
export async function processPDF(data: PDFUploadData): Promise<ProcessingResult> {
  const { title, topicId, uploadedBy, buffer } = data;
  const bookId = uuidv4();

  let client;

  try {
    // Start transaction
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Create book record with status='pending'
    await client.query(
      `INSERT INTO books (id, title, topic_id, uploaded_by, processing_status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [bookId, title, topicId, uploadedBy, 'pending']
    );

    // 2. Update status to 'processing'
    await client.query(
      'UPDATE books SET processing_status = $1 WHERE id = $2',
      ['processing', bookId]
    );

    // 3. Extract text from PDF page-by-page
    console.log(`Extracting text from PDF: ${title}`);
    const pages = await extractPagesFromPDF(buffer);

    if (pages.length === 0) {
      throw new Error('No text content found in PDF. The file may be empty or contain only images.');
    }

    console.log(`Extracted ${pages.length} pages from PDF`);

    // 4. Process pages in batches to avoid memory issues
    const BATCH_SIZE = 50; // Process 50 pages at a time
    let totalChunksProcessed = 0;
    let globalChunkIndex = 0;

    console.log(`Processing in batches of ${BATCH_SIZE} pages...`);

    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const pageBatch = pages.slice(i, i + BATCH_SIZE);
      console.log(`Processing pages ${i + 1}-${Math.min(i + BATCH_SIZE, pages.length)} of ${pages.length}`);

      // Chunk this batch of pages
      const chunks = chunkPagedText(pageBatch);

      // Process each chunk: embed and store
      for (const chunk of chunks) {
        const chunkId = uuidv4();

        // Generate embedding
        const embedding = await generateEmbedding(chunk.text);

        // Store in PostgreSQL
        await client.query(
          `INSERT INTO document_chunks
           (id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            chunkId,
            bookId,
            topicId,
            chunk.text,
            JSON.stringify(embedding), // Store as JSON for pgvector
            chunk.pageNumber,
            title,
            globalChunkIndex++
          ]
        );

        // Store in ChromaDB
        await addDocumentChunk(chunkId, chunk.text, {
          book_title: title,
          page_number: chunk.pageNumber,
          book_id: bookId,
          topic_id: topicId
        });

        totalChunksProcessed++;

        // Log progress every 25 chunks
        if (totalChunksProcessed % 25 === 0) {
          console.log(`Processed ${totalChunksProcessed} chunks so far...`);
        }
      }

      // Force garbage collection hint after each batch
      if (global.gc) {
        global.gc();
      }
    }

    // 6. Update status to 'complete'
    await client.query(
      'UPDATE books SET processing_status = $1 WHERE id = $2',
      ['complete', bookId]
    );

    // Commit transaction
    await client.query('COMMIT');

    console.log(`Successfully processed PDF: ${title} (${totalChunksProcessed} chunks from ${pages.length} pages)`);

    return {
      success: true,
      bookId,
      chunksProcessed: totalChunksProcessed
    };
  } catch (error) {
    // Rollback transaction
    if (client) {
      await client.query('ROLLBACK');
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error processing PDF:', errorMessage);

    // Update book status to 'failed' with error message
    try {
      await pool.query(
        'UPDATE books SET processing_status = $1, error_message = $2 WHERE id = $3',
        ['failed', errorMessage, bookId]
      );
    } catch (updateError) {
      console.error('Failed to update book status:', updateError);
    }

    return {
      success: false,
      bookId,
      chunksProcessed: 0,
      error: errorMessage
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Delete a book and all its chunks from both databases
 */
export async function deleteBook(bookId: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get all chunk IDs for this book (needed for ChromaDB deletion)
    const chunkResult = await client.query(
      'SELECT id FROM document_chunks WHERE book_id = $1',
      [bookId]
    );

    const chunkIds = chunkResult.rows.map((row: any) => row.id);

    // Delete from PostgreSQL (cascades to document_chunks via FK)
    await client.query('DELETE FROM document_chunks WHERE book_id = $1', [bookId]);
    await client.query('DELETE FROM books WHERE id = $1', [bookId]);

    await client.query('COMMIT');

    // Delete from ChromaDB
    if (chunkIds.length > 0) {
      const { getCollection } = await import('./vectorSearch');
      const collection = await getCollection();
      await collection.delete({ ids: chunkIds });
      console.log(`Deleted ${chunkIds.length} chunks from ChromaDB`);
    }

    console.log(`Successfully deleted book ${bookId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting book:', error);
    throw error;
  } finally {
    client.release();
  }
}
