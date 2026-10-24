import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JWTPayload } from '../types';
import { User } from '../models/User';
import { getJwtSecret } from '../services/auth.service';

/** Verifies the JWT, then re-checks the account in the DB so deactivated users lose access immediately. */
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Access denied. No authentication token provided.' });
    return;
  }

  let decoded: JWTPayload;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], getJwtSecret()) as JWTPayload;
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired authentication token.' });
    return;
  }

  try {
    const user = await User.findById(decoded.userId).select('role email isActive mustChangePassword');
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'Account is inactive or no longer exists.' });
      return;
    }
    // Use the DB role (not the token's) so role changes apply immediately.
    req.user = { userId: user._id.toString(), email: user.email, role: user.role };

    // Block everything except changing the password until a temporary password is replaced.
    if (user.mustChangePassword && !req.originalUrl.endsWith('/auth/change-password') && !req.originalUrl.endsWith('/auth/me')) {
      res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your temporary password first.' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
