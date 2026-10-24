import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import * as c from '../controllers/notification.controller';

const router = Router();
router.use(authenticate);

router.get('/inbox', c.getMyInbox);
router.put('/:id/read', c.markAsRead);
router.put('/read-all', c.markAllAsRead);

export default router;
