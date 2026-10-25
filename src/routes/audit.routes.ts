import { Router, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import { AuditLog } from '../models/AuditLog';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);
router.use(authorizeRoles('admin')); // Only Admin can view audit logs (Brief #25)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { action, entity, search, limit = '100' } = req.query;
    const filter: any = { tenantId: req.user!.tenantId };

    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (search) {
      filter.$or = [
        { actorEmail: new RegExp(String(search), 'i') },
        { entityId: new RegExp(String(search), 'i') },
      ];
    }

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Number(limit) || 100))
      .lean();

    res.json({ success: true, logs, total: logs.length });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
