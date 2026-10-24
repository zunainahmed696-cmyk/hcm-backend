import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as notifService from '../services/notification.service';

type Handler = (req: AuthRequest, res: Response) => Promise<{ status?: number; body?: object }>;

const wrap = (fn: Handler) => async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await fn(req, res);
    if (result) {
      const { status = 200, body } = result;
      res.status(status).json({ success: true, ...body });
    }
  } catch (error) {
    next(error);
  }
};

export const getMyInbox = wrap(async (req) => {
  const result = await notifService.getMyInbox(req.user!);
  return { body: result };
});

export const markAsRead = wrap(async (req) => {
  const item = await notifService.markAsRead(req.user!, req.params.id);
  return { body: { item } };
});

export const markAllAsRead = wrap(async (req) => {
  const result = await notifService.markAllAsRead(req.user!);
  return { body: result };
});
