import OpenAI from 'openai';
import pool from '../config/database';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const EMBEDDING_MODEL = 'text-embedding-3-small';

interface SearchResult {
  id: string;
  text: string;
  metadata: {
    book_title: string;
    page_number: number;
    book_id: string;
    topic_id: string;
  };
  distance: number;
}

/**
 * Generate embeddings for a text using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });

  return response.data[0].embedding;
}

/**
 * Search for relevant documents in the vector database using pgvector
 * Uses cosine distance for similarity search
 */
export async function searchSimilarDocuments(
  query: string,
  topicId?: string,
  topK: number = 5
): Promise<SearchResult[]> {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // Convert embedding array to PostgreSQL vector format
    const embeddingString = `[${queryEmbedding.join(',')}]`;

    // Build query with optional topic filter
    let queryText = `
      SELECT
        id::text,
        text,
        book_title,
        page_number,
        book_id::text,
        topic_id::text,
        embedding <=> $1::vector as distance
      FROM document_chunks
    `;

    const queryParams: any[] = [embeddingString];

    if (topicId) {
      queryText += ` WHERE topic_id = $2`;
      queryParams.push(topicId);
    }

    queryText += `
      ORDER BY embedding <=> $1::vector
      LIMIT $${queryParams.length + 1}
    `;
    queryParams.push(topK);

    const result = await pool.query(queryText, queryParams);

    // Transform results to our format
    const searchResults: SearchResult[] = result.rows.map(row => ({
      id: row.id,
      text: row.text,
      metadata: {
        book_title: row.book_title,
        page_number: row.page_number,
        book_id: row.book_id,
        topic_id: row.topic_id
      },
      distance: parseFloat(row.distance)
    }));

    return searchResults;
  } catch (error) {
    console.error('Error searching similar documents:', error);
    throw error;
  }
}

/**
 * Add a document chunk to the vector database
 * Note: This function is kept for API compatibility but in the new architecture,
 * chunks are added directly via bookProcessorNew.ts during PDF processing
 */
export async function addDocumentChunk(
  id: string,
  text: string,
  metadata: {
    book_title: string;
    page_number: number;
    book_id: string;
    topic_id: string;
  }
): Promise<void> {
  try {
    const embedding = await generateEmbedding(text);
    const embeddingString = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO document_chunks (id, book_id, topic_id, text, embedding, page_number, book_title, chunk_index)
       VALUES ($1, $2, $3, $4, $5::vector, $6, $7, 0)
       ON CONFLICT (id) DO UPDATE SET
         text = EXCLUDED.text,
         embedding = EXCLUDED.embedding,
         page_number = EXCLUDED.page_number,
         book_title = EXCLUDED.book_title`,
      [id, metadata.book_id, metadata.topic_id, text, embeddingString, metadata.page_number, metadata.book_title]
    );

    console.log(`Added document chunk ${id} to vector database`);
  } catch (error) {
    console.error('Error adding document chunk:', error);
    throw error;
  }
}

/**
 * Check if the vector database has any documents
 */
export async function hasDocuments(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM document_chunks');
    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking document count:', error);
    return false;
  }
}

/**
 * Get count of documents in the vector database
 */
export async function getDocumentCount(): Promise<number> {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM document_chunks');
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error getting document count:', error);
    return 0;
  }
}
