import { Router } from 'express';
import { setupStatus, setup, login, changePassword, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Public routes
router.get('/setup-status', setupStatus);
router.post('/setup', setup);
router.post('/login', login);

// Protected routes (any authenticated user)
router.get('/me', authenticate, getMe);
router.post('/change-password', authenticate, changePassword);

export default router;
