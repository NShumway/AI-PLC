import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { processQuery, validateQuery } from '../services/rag';
import pool from '../config/database';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/topics
 * Get list of available topics
 */
router.get('/topics', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM topics ORDER BY name ASC'
    );

    // Always include "All Topics" option at the beginning
    const topics = [
      { id: null, name: 'All Topics' },
      ...result.rows
    ];

    res.json(topics);
  } catch (error) {
    console.error('Error fetching topics:', error);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

/**
 * GET /api/topics/:id/messages
 * Get chat message history for a specific topic
 */
router.get('/topics/:id/messages', async (req, res) => {
  try {
    const topicId = req.params.id === 'null' ? null : req.params.id;

    let query: string;
    let params: any[];

    if (topicId === null) {
      // Get all messages across all topics
      query = `
        SELECT id, topic_id, role, content, citations, created_at
        FROM messages
        ORDER BY created_at ASC
      `;
      params = [];
    } else {
      // Get messages for specific topic
      query = `
        SELECT id, topic_id, role, content, citations, created_at
        FROM messages
        WHERE topic_id = $1
        ORDER BY created_at ASC
      `;
      params = [topicId];
    }

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/topics/:id/messages
 * Send a message and get AI response using RAG
 */
router.post('/topics/:id/messages', async (req, res) => {
  try {
    const topicId = req.params.id === 'null' ? null : req.params.id;
    const { content } = req.body;

    // Validate the query
    const validation = validateQuery(content);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Save user message
    const userMessageResult = await pool.query(
      `INSERT INTO messages (topic_id, role, content, citations)
       VALUES ($1, $2, $3, $4)
       RETURNING id, topic_id, role, content, citations, created_at`,
      [topicId, 'user', content, null]
    );

    const userMessage = userMessageResult.rows[0];

    // Process query with RAG
    const ragResponse = await processQuery(content, topicId || undefined);

    // Save assistant response
    const assistantMessageResult = await pool.query(
      `INSERT INTO messages (topic_id, role, content, citations)
       VALUES ($1, $2, $3, $4)
       RETURNING id, topic_id, role, content, citations, created_at`,
      [
        topicId,
        'assistant',
        ragResponse.answer,
        JSON.stringify(ragResponse.citations)
      ]
    );

    const assistantMessage = assistantMessageResult.rows[0];

    // Return both messages
    res.json({
      userMessage,
      assistantMessage
    });

  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

/**
 * DELETE /api/topics/:id/messages
 * Clear all messages for a specific topic
 */
router.delete('/topics/:id/messages', async (req, res) => {
  try {
    const topicId = req.params.id === 'null' ? null : req.params.id;

    if (topicId === null) {
      // Clear all messages
      await pool.query('DELETE FROM messages');
    } else {
      // Clear messages for specific topic
      await pool.query('DELETE FROM messages WHERE topic_id = $1', [topicId]);
    }

    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({ error: 'Failed to clear messages' });
  }
});

export default router;
