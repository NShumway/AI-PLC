import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Placeholder routes - will be implemented in Phase 2
router.get('/topics', async (req, res) => {
  res.json([{ id: null, name: 'All Topics' }]);
});

router.get('/topics/:id/messages', async (req, res) => {
  res.json([]);
});

router.post('/topics/:id/messages', async (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - Phase 2' });
});

export default router;
