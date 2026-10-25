import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/org.controller';

const router = Router();
router.use(authenticate);

// Company settings: Admin manages, HR views
router.get('/settings', authorizeRoles('admin', 'hr'), c.getSettings);
router.put('/settings', authorizeRoles('admin'), c.updateSettings);

// Catalogs: everyone signed in can read (leave form needs types/holidays); only Admin writes
router.get('/catalog/:entity', c.listCatalog);
router.post('/catalog/:entity', authorizeRoles('admin'), c.createCatalogItem);
router.put('/catalog/:entity/:id', authorizeRoles('admin'), c.updateCatalogItem);
router.delete('/catalog/:entity/:id', authorizeRoles('admin'), c.deleteCatalogItem);

// Shift Assignment: HR and Admin can view and assign shifts by department or employee
router.get('/shifts', authorizeRoles('admin', 'hr'), c.getShifts);
router.put('/shifts/department', authorizeRoles('admin', 'hr'), c.assignDeptShift);
router.put('/shifts/employee/:id', authorizeRoles('admin', 'hr'), c.assignEmpShift);

// Logins: Admin only
router.get('/users', authorizeRoles('admin'), c.listUsers);
router.post('/users/hr', authorizeRoles('admin'), c.createHr);
router.patch('/users/:id/status', authorizeRoles('admin'), c.setActive);
router.post('/users/:id/reset-password', authorizeRoles('admin'), c.resetPassword);

export default router;
