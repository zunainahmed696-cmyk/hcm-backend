import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/payroll.controller';

const router = Router();
router.use(authenticate);

// Employee: own payslips only
router.get('/my-payslips', c.getMyPayslips);

// HR & Admin: calculate monthly draft
router.get('/draft', authorizeRoles('admin', 'hr'), c.getPayrollDraft);

// Admin only: finalize and lock payroll run
router.post('/finalize', authorizeRoles('admin'), c.finalizePayroll);

export default router;
