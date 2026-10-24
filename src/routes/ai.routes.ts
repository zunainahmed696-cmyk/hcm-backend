import { Router, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { handleAIChat, generateDashboardSummary } from '../services/ai.service';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);

router.post('/chat', async (req: AuthRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ success: false, message: 'Message prompt is required.' });
      return;
    }

    const reply = await handleAIChat(req.user!, message);
    res.json({
      success: true,
      reply,
      roleScope: req.user!.role,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/summarize', async (req: AuthRequest, res: Response) => {
  try {
    const bullets = await generateDashboardSummary(req.user!);
    res.json({
      success: true,
      bullets,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
