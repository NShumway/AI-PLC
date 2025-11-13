// Mock environment variables before imports
process.env.OPENAI_API_KEY = 'test-key';
process.env.CHROMA_URL = 'http://localhost:8000';

// Mock dependencies
const mockQuery = jest.fn();
const mockAdd = jest.fn();
const mockCount = jest.fn();
const mockGetCollection = jest.fn();
const mockCreateCollection = jest.fn();
const mockEmbeddingsCreate = jest.fn();

jest.mock('chromadb', () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getCollection: mockGetCollection,
    createCollection: mockCreateCollection
  }))
}));

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: {
      create: mockEmbeddingsCreate
    }
  }));
});

import {
  getCollection,
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

  describe('getCollection', () => {
    it('should return existing collection if it exists', async () => {
      const mockCollection = { name: 'plc_documents' };
      mockGetCollection.mockResolvedValue(mockCollection);

      const result = await getCollection();

      expect(result).toBe(mockCollection);
      expect(mockGetCollection).toHaveBeenCalledWith({ name: 'plc_documents' });
      expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    it('should create collection if it does not exist', async () => {
      const mockCollection = { name: 'plc_documents' };
      mockGetCollection.mockRejectedValue(new Error('Collection not found'));
      mockCreateCollection.mockResolvedValue(mockCollection);

      const result = await getCollection();

      expect(result).toBe(mockCollection);
      expect(mockCreateCollection).toHaveBeenCalledWith({
        name: 'plc_documents',
        metadata: { description: 'PLC course documents and books' }
      });
    });
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
      mockGetCollection.mockResolvedValue({
        query: mockQuery
      });
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }]
      });
    });

    it('should search for similar documents with query embedding', async () => {
      mockQuery.mockResolvedValue({
        ids: [['doc1', 'doc2']],
        documents: [['Text 1', 'Text 2']],
        metadatas: [[
          { book_title: 'Book 1', page_number: 5, book_id: 'b1', topic_id: 't1' },
          { book_title: 'Book 2', page_number: 10, book_id: 'b2', topic_id: 't1' }
        ]],
        distances: [[0.3, 0.4]]
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
        ids: [['doc1']],
        documents: [['Text 1']],
        metadatas: [[{ book_title: 'Book 1', page_number: 5, book_id: 'b1', topic_id: 'topic1' }]],
        distances: [[0.3]]
      });

      await searchSimilarDocuments('What is a PLC?', 'topic1');

      expect(mockQuery).toHaveBeenCalledWith({
        queryEmbeddings: expect.any(Array),
        nResults: 5,
        where: { topic_id: 'topic1' }
      });
    });

    it('should return empty array when no results found', async () => {
      mockQuery.mockResolvedValue({
        ids: [[]],
        documents: [[]],
        metadatas: [[]],
        distances: [[]]
      });

      const results = await searchSimilarDocuments('What is a PLC?');

      expect(results).toEqual([]);
    });

    it('should respect topK parameter', async () => {
      mockQuery.mockResolvedValue({
        ids: [[]],
        documents: [[]],
        metadatas: [[]],
        distances: [[]]
      });

      await searchSimilarDocuments('What is a PLC?', undefined, 10);

      expect(mockQuery).toHaveBeenCalledWith({
        queryEmbeddings: expect.any(Array),
        nResults: 10,
        where: undefined
      });
    });
  });

  describe('addDocumentChunk', () => {
    beforeEach(() => {
      mockGetCollection.mockResolvedValue({
        add: mockAdd
      });
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }]
      });
    });

    it('should add document chunk with generated embedding', async () => {
      const metadata = {
        book_title: 'PLC Basics',
        page_number: 5,
        book_id: 'book1',
        topic_id: 'topic1'
      };

      await addDocumentChunk('chunk1', 'Sample text', metadata);

      expect(mockAdd).toHaveBeenCalledWith({
        ids: ['chunk1'],
        embeddings: [expect.any(Array)],
        documents: ['Sample text'],
        metadatas: [metadata]
      });
      expect(mockEmbeddingsCreate).toHaveBeenCalled();
    });
  });

  describe('hasDocuments', () => {
    it('should return true when documents exist', async () => {
      mockGetCollection.mockResolvedValue({
        count: mockCount
      });
      mockCount.mockResolvedValue(10);

      const result = await hasDocuments();

      expect(result).toBe(true);
      expect(mockCount).toHaveBeenCalled();
    });

    it('should return false when no documents exist', async () => {
      mockGetCollection.mockResolvedValue({
        count: mockCount
      });
      mockCount.mockResolvedValue(0);

      const result = await hasDocuments();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockGetCollection.mockRejectedValue(new Error('Database error'));

      const result = await hasDocuments();

      expect(result).toBe(false);
    });
  });

  describe('getDocumentCount', () => {
    it('should return the count of documents', async () => {
      mockGetCollection.mockResolvedValue({
        count: mockCount
      });
      mockCount.mockResolvedValue(42);

      const result = await getDocumentCount();

      expect(result).toBe(42);
    });

    it('should return 0 on error', async () => {
      mockGetCollection.mockRejectedValue(new Error('Database error'));

      const result = await getDocumentCount();

      expect(result).toBe(0);
    });
  });
});
