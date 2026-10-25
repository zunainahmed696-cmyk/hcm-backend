import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/role.middleware';
import * as c from '../controllers/attendance.controller';

const router = Router();
router.use(authenticate);

// Quick check-in / out actions & accidental clock-out reset request
router.post('/check-in', c.checkIn);
router.post('/check-out', c.checkOut);
router.post('/request-clockout-reset', c.requestClockOutReset);
router.post('/clockout-reset-request', c.requestClockOutReset);
router.get('/today', c.getTodayStatus);

// Personal attendance calendar and corrections
router.get('/my-calendar', c.getMyCalendar);
router.post('/corrections', c.requestCorrection);
router.get('/corrections', c.getMyCorrections);

// HR / Admin daily attendance board, clock-out reset, manual override & corrections review
router.get('/board', authorizeRoles('admin', 'hr'), c.getDailyBoard);
router.get('/all', authorizeRoles('admin', 'hr'), c.listAll);
router.put('/override', authorizeRoles('admin', 'hr'), c.overrideAttendance);
router.post('/clockout-reset', authorizeRoles('admin', 'hr'), c.resetClockOutByBody);
router.post('/:id/reset-clockout', authorizeRoles('admin', 'hr'), c.resetClockOut);
router.put('/corrections/:id/review', authorizeRoles('admin', 'hr'), c.reviewCorrection);

export default router;
