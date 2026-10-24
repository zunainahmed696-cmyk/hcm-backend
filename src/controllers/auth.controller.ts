import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Settings } from '../models/Settings';
import { AuthRequest } from '../types';
import { AppError } from '../utils/AppError';
import {
  authenticateUser,
  changeUserPassword,
  isSetupComplete,
  runFirstSetup,
  signToken,
  toPublicUser,
} from '../services/auth.service';

export const setupStatus = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, setupComplete: await isSetupComplete() });
  } catch (error) {
    next(error);
  }
};

export const setup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const admin = await runFirstSetup(req.body);
    res.status(201).json({
      success: true,
      message: 'Company setup completed successfully. Please sign in with your credentials.',
      user: toPublicUser(admin),
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await authenticateUser(req.body.email, req.body.password);
    res.json({ success: true, message: 'Logged in successfully', token: signToken(user), user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await changeUserPassword(req.user!.userId, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true, message: 'Password changed', token: signToken(user), user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) throw new AppError('User not found.', 404);
    const settings = await Settings.findOne().lean();
    res.json({ success: true, user: toPublicUser(user), companyName: settings?.companyName ?? null });
  } catch (error) {
    next(error);
  }
};
