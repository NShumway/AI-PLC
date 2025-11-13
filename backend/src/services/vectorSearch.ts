import { ChromaClient } from 'chromadb';
import OpenAI from 'openai';

const client = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000'
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const COLLECTION_NAME = 'plc_documents';
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
 * Initialize or get the ChromaDB collection
 */
export async function getCollection() {
  try {
    // Try to get existing collection
    const collection = await client.getCollection({
      name: COLLECTION_NAME
    });
    return collection;
  } catch (error) {
    // Collection doesn't exist, create it
    console.log('Creating new ChromaDB collection:', COLLECTION_NAME);
    const collection = await client.createCollection({
      name: COLLECTION_NAME,
      metadata: { description: 'PLC course documents and books' }
    });
    return collection;
  }
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
 * Search for relevant documents in the vector database
 */
export async function searchSimilarDocuments(
  query: string,
  topicId?: string,
  topK: number = 5
): Promise<SearchResult[]> {
  try {
    const collection = await getCollection();

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // Build filter for topic if specified
    const whereFilter = topicId ? { topic_id: topicId } : undefined;

    // Search in ChromaDB
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: whereFilter
    });

    // Check if we got any results
    if (!results.ids || !results.ids[0] || results.ids[0].length === 0) {
      return [];
    }

    // Transform results to our format
    const searchResults: SearchResult[] = results.ids[0].map((id, index) => ({
      id: id as string,
      text: results.documents?.[0]?.[index] as string || '',
      metadata: results.metadatas?.[0]?.[index] as any || {},
      distance: results.distances?.[0]?.[index] as number || 1.0
    }));

    return searchResults;
  } catch (error) {
    console.error('Error searching similar documents:', error);
    throw error;
  }
}

/**
 * Add a document chunk to the vector database
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
    const collection = await getCollection();
    const embedding = await generateEmbedding(text);

    await collection.add({
      ids: [id],
      embeddings: [embedding],
      documents: [text],
      metadatas: [metadata]
    });

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
    const collection = await getCollection();
    const count = await collection.count();
    return count > 0;
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
    const collection = await getCollection();
    return await collection.count();
  } catch (error) {
    console.error('Error getting document count:', error);
    return 0;
  }
}
