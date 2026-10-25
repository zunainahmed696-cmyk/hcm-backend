import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/notification.controller';

const router = Router();
router.use(authenticate);

router.get('/inbox', c.getMyInbox);
router.post('/announcements', authorizeRoles('admin'), c.createAnnouncement);
router.delete('/announcements/:id', authorizeRoles('admin'), c.deleteAnnouncement);
router.put('/:id/read', c.markAsRead);
router.put('/read-all', c.markAllAsRead);

export default router;
