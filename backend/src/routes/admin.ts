import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';

const router = Router();

// All routes require admin authentication
router.use(requireAdmin);

// Placeholder routes - will be implemented in Phase 3
router.get('/topics', async (req, res) => {
  res.json([]);
});

router.post('/topics', async (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - Phase 3' });
});

router.get('/books', async (req, res) => {
  res.json([]);
});

router.post('/books/upload', async (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - Phase 3' });
});

export default router;
