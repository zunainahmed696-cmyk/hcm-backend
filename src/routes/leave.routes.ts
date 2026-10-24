import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/leave.controller';

const router = Router();
router.use(authenticate);

// Personal leave operations (Scoped to the authenticated employee)
router.get('/my-leaves', c.getMyLeaves);
router.post('/apply', c.applyLeave);
router.post('/:id/cancel', c.cancelLeave);
router.post('/smart-parse', c.smartParse);
router.get('/preview-days', c.previewWorkingDays);

// HR & Admin review operations
router.get('/pending', authorizeRoles('admin', 'hr'), c.listPending);
router.get('/all', authorizeRoles('admin', 'hr'), c.listAll);
router.put('/:id/review', authorizeRoles('admin', 'hr'), c.updateStatus);

export default router;
