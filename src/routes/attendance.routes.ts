import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/attendance.controller';

const router = Router();
router.use(authenticate);

// Quick check-in / out actions
router.post('/check-in', c.checkIn);
router.post('/check-out', c.checkOut);
router.get('/today', c.getTodayStatus);

// Personal attendance calendar and corrections
router.get('/my-calendar', c.getMyCalendar);
router.post('/corrections', c.requestCorrection);
router.get('/corrections', c.getMyCorrections);

// HR / Admin daily attendance board & corrections review
router.get('/all', authorizeRoles('admin', 'hr'), c.listAll);
router.put('/corrections/:id/review', authorizeRoles('admin', 'hr'), c.reviewCorrection);

export default router;

