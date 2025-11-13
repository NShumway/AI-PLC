// Mock environment variables before imports
process.env.OPENAI_API_KEY = 'test-key';
process.env.CHROMA_URL = 'http://localhost:8000';

// Mock OpenAI
const mockChatCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCreate
      }
    }
  }));
});

// Mock the vector search module before importing anything else
jest.mock('../services/vectorSearch', () => ({
  hasDocuments: jest.fn(),
  searchSimilarDocuments: jest.fn(),
  generateEmbedding: jest.fn(),
  getCollection: jest.fn(),
  addDocumentChunk: jest.fn(),
  getDocumentCount: jest.fn()
}));

// Now import the services
import { processQuery, validateQuery } from '../services/rag';
import * as vectorSearch from '../services/vectorSearch';

describe('RAG Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default OpenAI response
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Test AI response based on context' } }]
    });
  });

  describe('Empty Vector Database', () => {
    it('should return appropriate message when no documents exist', async () => {
      // Mock empty database
      (vectorSearch.hasDocuments as jest.Mock).mockResolvedValue(false);

      const result = await processQuery('What is a PLC?');

      expect(result.hasRelevantDocs).toBe(false);
      expect(result.citations).toEqual([]);
      expect(result.answer).toContain("don't have any documents");
      expect(result.answer.toLowerCase()).toMatch(/knowledge base|documents|uploaded/);
    });

    it('should handle different queries consistently when database is empty', async () => {
      (vectorSearch.hasDocuments as jest.Mock).mockResolvedValue(false);

      const queries = [
        'How do I program a ladder logic circuit?',
        'What are the basic components of a PLC?',
        'Tell me about industrial automation'
      ];

      for (const query of queries) {
        const result = await processQuery(query);
        expect(result.hasRelevantDocs).toBe(false);
        expect(result.citations).toEqual([]);
      }
    });
  });

  describe('Query Validation', () => {
    it('should reject empty queries', () => {
      const result = validateQuery('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject queries with only whitespace', () => {
      const result = validateQuery('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject queries that are too long', () => {
      const longQuery = 'a'.repeat(2001);
      const result = validateQuery(longQuery);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should accept valid queries', () => {
      const result = validateQuery('What is a PLC?');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept queries at the maximum length', () => {
      const maxQuery = 'a'.repeat(2000);
      const result = validateQuery(maxQuery);
      expect(result.valid).toBe(true);
    });
  });

  describe('Query Processing with Documents', () => {
    it('should return no results when similarity threshold is not met', async () => {
      (vectorSearch.hasDocuments as jest.Mock).mockResolvedValue(true);
      (vectorSearch.searchSimilarDocuments as jest.Mock).mockResolvedValue([
        {
          id: '1',
          text: 'Some irrelevant text',
          metadata: { book_title: 'PLC Basics', page_number: 5, book_id: 'book1', topic_id: 'topic1' },
          distance: 0.9 // High distance = low similarity
        }
      ]);

      const result = await processQuery('What is a PLC?');

      expect(result.hasRelevantDocs).toBe(false);
      expect(result.answer).toContain("couldn't find any relevant information");
    });

    it('should include citations when relevant documents are found', async () => {
      (vectorSearch.hasDocuments as jest.Mock).mockResolvedValue(true);
      (vectorSearch.searchSimilarDocuments as jest.Mock).mockResolvedValue([
        {
          id: '1',
          text: 'A PLC is a programmable logic controller',
          metadata: { book_title: 'PLC Basics', page_number: 5, book_id: 'book1', topic_id: 'topic1' },
          distance: 0.3 // Low distance = high similarity
        },
        {
          id: '2',
          text: 'PLCs are used in industrial automation',
          metadata: { book_title: 'Industrial Control', page_number: 12, book_id: 'book2', topic_id: 'topic1' },
          distance: 0.4
        }
      ]);

      const result = await processQuery('What is a PLC?');

      expect(result.hasRelevantDocs).toBe(true);
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.citations).toContainEqual({
        book_title: 'PLC Basics',
        page_number: 5
      });
    });

    it('should deduplicate citations from the same page', async () => {
      (vectorSearch.hasDocuments as jest.Mock).mockResolvedValue(true);
      (vectorSearch.searchSimilarDocuments as jest.Mock).mockResolvedValue([
        {
          id: '1',
          text: 'First chunk from page 5',
          metadata: { book_title: 'PLC Basics', page_number: 5, book_id: 'book1', topic_id: 'topic1' },
          distance: 0.3
        },
        {
          id: '2',
          text: 'Second chunk from page 5',
          metadata: { book_title: 'PLC Basics', page_number: 5, book_id: 'book1', topic_id: 'topic1' },
          distance: 0.35
        }
      ]);

      const result = await processQuery('What is a PLC?');

      expect(result.citations.length).toBe(1);
      expect(result.citations[0]).toEqual({
        book_title: 'PLC Basics',
        page_number: 5
      });
    });
  });
});
