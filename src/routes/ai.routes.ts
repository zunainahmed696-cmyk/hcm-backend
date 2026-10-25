import { Router, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { handleAIChat, generateDashboardSummary } from '../services/ai.service';
import { Settings } from '../models/Settings';
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

    const [reply, settings] = await Promise.all([
      handleAIChat(req.user!, message),
      Settings.findById(req.user!.tenantId).select('companyName').lean(),
    ]);

    res.json({
      success: true,
      reply,
      roleScope: req.user!.role,
      tenantId: req.user!.tenantId,
      companyName: settings?.companyName || 'HCM Workspace',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

const handleSummary = async (req: AuthRequest, res: Response) => {
  try {
    const bullets = await generateDashboardSummary(req.user!);
    res.json({
      success: true,
      bullets,
      summary: bullets.map((b) => b.replace(/\*\*/g, '')).join(' • '),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

router.post('/summarize', handleSummary);
router.get('/summary', handleSummary);

export default router;
