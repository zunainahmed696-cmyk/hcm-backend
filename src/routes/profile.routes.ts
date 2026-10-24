import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/profile.controller';

const router = Router();
router.use(authenticate);

router.get('/me', c.getMyProfile);
router.put('/me', c.updateMyProfile);
router.get('/dashboard', c.getDashboard);
router.get('/dashboard/admin', authorizeRoles('admin'), c.getAdminDashboard);
router.get('/dashboard/hr', authorizeRoles('admin', 'hr'), c.getHRDashboard);

export default router;

