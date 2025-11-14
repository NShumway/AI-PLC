// Mock environment variables before imports
process.env.OPENAI_API_KEY = 'test-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// Mock dependencies
const mockQuery = jest.fn();
const mockEmbeddingsCreate = jest.fn();

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: mockQuery
  }
}));

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: {
      create: mockEmbeddingsCreate
    }
  }));
});

import {
  generateEmbedding,
  searchSimilarDocuments,
  addDocumentChunk,
  hasDocuments,
  getDocumentCount
} from '../services/vectorSearch';

describe('Vector Search Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings using OpenAI', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }]
      });

      const result = await generateEmbedding('test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text'
      });
    });

    it('should handle different text inputs', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }]
      });

      await generateEmbedding('A PLC is a programmable logic controller');

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'A PLC is a programmable logic controller'
      });
    });
  });

  describe('searchSimilarDocuments', () => {
    beforeEach(() => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }]
      });
    });

    it('should search for similar documents using pgvector', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'doc1',
            text: 'Text 1',
            book_title: 'Book 1',
            page_number: 5,
            book_id: 'b1',
            topic_id: 't1',
            distance: '0.3'
          },
          {
            id: 'doc2',
            text: 'Text 2',
            book_title: 'Book 2',
            page_number: 10,
            book_id: 'b2',
            topic_id: 't1',
            distance: '0.4'
          }
        ]
      });

      const results = await searchSimilarDocuments('What is a PLC?');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: 'doc1',
        text: 'Text 1',
        metadata: { book_title: 'Book 1', page_number: 5, book_id: 'b1', topic_id: 't1' },
        distance: 0.3
      });
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should filter by topic when provided', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'doc1',
            text: 'Text 1',
            book_title: 'Book 1',
            page_number: 5,
            book_id: 'b1',
            topic_id: 'topic1',
            distance: '0.3'
          }
        ]
      });

      await searchSimilarDocuments('What is a PLC?', 'topic1');

      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[0]).toContain('WHERE topic_id = $2');
      expect(queryCall[1]).toContain('topic1');
    });

    it('should return empty array when no results found', async () => {
      mockQuery.mockResolvedValue({
        rows: []
      });

      const results = await searchSimilarDocuments('What is a PLC?');

      expect(results).toEqual([]);
    });

    it('should respect topK parameter', async () => {
      mockQuery.mockResolvedValue({
        rows: []
      });

      await searchSimilarDocuments('What is a PLC?', undefined, 10);

      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[1][queryCall[1].length - 1]).toBe(10);
    });
  });

  describe('addDocumentChunk', () => {
    beforeEach(() => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }]
      });
      mockQuery.mockResolvedValue({ rows: [] });
    });

    it('should add document chunk with generated embedding to PostgreSQL', async () => {
      const metadata = {
        book_title: 'PLC Basics',
        page_number: 5,
        book_id: 'book1',
        topic_id: 'topic1'
      };

      await addDocumentChunk('chunk1', 'Sample text', metadata);

      expect(mockQuery).toHaveBeenCalled();
      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[0]).toContain('INSERT INTO document_chunks');
      expect(queryCall[1]).toContain('chunk1');
      expect(queryCall[1]).toContain('Sample text');
      expect(mockEmbeddingsCreate).toHaveBeenCalled();
    });
  });

  describe('hasDocuments', () => {
    it('should return true when documents exist', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '10' }]
      });

      const result = await hasDocuments();

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM document_chunks');
    });

    it('should return false when no documents exist', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '0' }]
      });

      const result = await hasDocuments();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockQuery.mockRejectedValue(new Error('Database error'));

      const result = await hasDocuments();

      expect(result).toBe(false);
    });
  });

  describe('getDocumentCount', () => {
    it('should return the count of documents', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '42' }]
      });

      const result = await getDocumentCount();

      expect(result).toBe(42);
    });

    it('should return 0 on error', async () => {
      mockQuery.mockRejectedValue(new Error('Database error'));

      const result = await getDocumentCount();

      expect(result).toBe(0);
    });
  });
});
