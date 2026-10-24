import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types';
import { Permission, can } from '../config/rbac';

export const authorizeRoles = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Please login to access this resource.',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' is not authorized to access this resource. Required role(s): [${allowedRoles.join(', ')}]`,
      });
      return;
    }

    next();
  };
};

export const authorizePermission = (permission: Permission) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Please login to access this resource.',
      });
      return;
    }

    if (!can(req.user.role, permission)) {
      res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' lacks permission '${permission}' for this resource.`,
      });
      return;
    }

    next();
  };
};

