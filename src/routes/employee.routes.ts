import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/employee.controller';

const router = Router();
router.use(authenticate);

// List employees - accessible to admin, hr, employee
router.get('/', c.listEmployees);

// Sample template download - admin, hr
router.get('/sample-template', authorizeRoles('admin', 'hr'), c.getSampleCSV);

// Export CSV - admin, hr
router.get('/export', authorizeRoles('admin', 'hr'), c.exportCSV);

// Create single employee - admin, hr
router.post('/', authorizeRoles('admin', 'hr'), c.createEmployee);

// Bulk import CSV (with dryRun query param support) - admin, hr
router.post('/bulk', authorizeRoles('admin', 'hr'), c.bulkImport);

// Get single employee - scoped inside controller/service
router.get('/:id', c.getEmployeeById);

// Update employee - scoped inside controller/service
router.put('/:id', c.updateEmployee);

// Reset employee password - admin, hr
router.post('/:id/reset-password', authorizeRoles('admin', 'hr'), c.resetPassword);

export default router;
