// Mock environment variables
process.env.OPENAI_API_KEY = 'test-key';
process.env.CHROMA_URL = 'http://localhost:8000';

import request from 'supertest';
import express from 'express';
import chatRoutes from '../routes/chat';
import * as rag from '../services/rag';
import pool from '../config/database';

// Mock dependencies
jest.mock('../services/rag');
jest.mock('../config/database', () => ({
  query: jest.fn()
}));

jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { id: 'user1', email: 'test@example.com' };
    next();
  }
}));

// Create test app
const app = express();
app.use(express.json());
app.use('/api', chatRoutes);

describe('Chat API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/topics', () => {
    it('should return list of topics with "All Topics" first', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [
          { id: 'topic1', name: 'Ladder Logic' },
          { id: 'topic2', name: 'Industrial Control' }
        ]
      });

      const response = await request(app).get('/api/topics');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toEqual({ id: null, name: 'All Topics' });
      expect(response.body[1].name).toBe('Ladder Logic');
    });

    it('should handle database errors gracefully', async () => {
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/topics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch topics');
    });
  });

  describe('GET /api/topics/:id/messages', () => {
    it('should return messages for a specific topic', async () => {
      const mockMessages = [
        {
          id: 'msg1',
          topic_id: 'topic1',
          role: 'user',
          content: 'What is a PLC?',
          citations: null,
          created_at: new Date().toISOString()
        },
        {
          id: 'msg2',
          topic_id: 'topic1',
          role: 'assistant',
          content: 'A PLC is a programmable logic controller',
          citations: JSON.stringify([{ book_title: 'PLC Basics', page_number: 5 }]),
          created_at: new Date().toISOString()
        }
      ];

      (pool.query as jest.Mock).mockResolvedValue({ rows: mockMessages });

      const response = await request(app).get('/api/topics/topic1/messages');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE topic_id = $1'),
        ['topic1']
      );
    });

    it('should return all messages when topic is null', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const response = await request(app).get('/api/topics/null/messages');

      expect(response.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at ASC'),
        []
      );
    });

    it('should handle database errors', async () => {
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/topics/topic1/messages');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch messages');
    });
  });

  describe('POST /api/topics/:id/messages', () => {
    it('should process message and return both user and assistant messages', async () => {
      const userMessage = {
        id: 'msg1',
        topic_id: 'topic1',
        role: 'user',
        content: 'What is a PLC?',
        citations: null,
        created_at: new Date().toISOString()
      };

      const assistantMessage = {
        id: 'msg2',
        topic_id: 'topic1',
        role: 'assistant',
        content: 'A PLC is a programmable logic controller',
        citations: JSON.stringify([{ book_title: 'PLC Basics', page_number: 5 }]),
        created_at: new Date().toISOString()
      };

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [userMessage] })
        .mockResolvedValueOnce({ rows: [assistantMessage] });

      (rag.validateQuery as jest.Mock).mockReturnValue({ valid: true });
      (rag.processQuery as jest.Mock).mockResolvedValue({
        answer: 'A PLC is a programmable logic controller',
        citations: [{ book_title: 'PLC Basics', page_number: 5 }],
        hasRelevantDocs: true
      });

      const response = await request(app)
        .post('/api/topics/topic1/messages')
        .send({ content: 'What is a PLC?' });

      expect(response.status).toBe(200);
      expect(response.body.userMessage).toBeDefined();
      expect(response.body.assistantMessage).toBeDefined();
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('should reject empty queries', async () => {
      (rag.validateQuery as jest.Mock).mockReturnValue({
        valid: false,
        error: 'Query cannot be empty'
      });

      const response = await request(app)
        .post('/api/topics/topic1/messages')
        .send({ content: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Query cannot be empty');
    });

    it('should reject queries that are too long', async () => {
      (rag.validateQuery as jest.Mock).mockReturnValue({
        valid: false,
        error: 'Query is too long (max 2000 characters)'
      });

      const response = await request(app)
        .post('/api/topics/topic1/messages')
        .send({ content: 'a'.repeat(2001) });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('too long');
    });

    it('should handle null topic (All Topics)', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'msg1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'msg2' }] });

      (rag.validateQuery as jest.Mock).mockReturnValue({ valid: true });
      (rag.processQuery as jest.Mock).mockResolvedValue({
        answer: 'Test answer',
        citations: [],
        hasRelevantDocs: false
      });

      const response = await request(app)
        .post('/api/topics/null/messages')
        .send({ content: 'What is a PLC?' });

      expect(response.status).toBe(200);
      expect(rag.processQuery).toHaveBeenCalledWith('What is a PLC?', undefined);
    });

    it('should handle processing errors', async () => {
      (rag.validateQuery as jest.Mock).mockReturnValue({ valid: true });
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/topics/topic1/messages')
        .send({ content: 'What is a PLC?' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to process message');
    });
  });

  describe('DELETE /api/topics/:id/messages', () => {
    it('should clear messages for a specific topic', async () => {
      (pool.query as jest.Mock).mockResolvedValue({});

      const response = await request(app).delete('/api/topics/topic1/messages');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM messages WHERE topic_id = $1',
        ['topic1']
      );
    });

    it('should clear all messages when topic is null', async () => {
      (pool.query as jest.Mock).mockResolvedValue({});

      const response = await request(app).delete('/api/topics/null/messages');

      expect(response.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith('DELETE FROM messages');
    });

    it('should handle database errors', async () => {
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app).delete('/api/topics/topic1/messages');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to clear messages');
    });
  });
});
