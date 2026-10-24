import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as attService from '../services/attendance.service';

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

export const checkIn = wrap(async (req) => {
  const attendance = await attService.checkIn(req.user!, req.body);
  return { status: 201, body: { attendance, message: 'Check-in recorded successfully.' } };
});

export const checkOut = wrap(async (req) => {
  const attendance = await attService.checkOut(req.user!, req.body);
  return { status: 200, body: { attendance, message: 'Check-out recorded successfully.' } };
});

export const getTodayStatus = wrap(async (req) => {
  const result = await attService.getTodayStatus(req.user!);
  return { body: result };
});

export const getMyCalendar = wrap(async (req) => {
  const result = await attService.getMyCalendar(req.user!, req.query.month as string);
  return { body: result };
});

export const requestCorrection = wrap(async (req) => {
  const attendance = await attService.requestCorrection(req.user!, req.body);
  return { status: 201, body: { attendance, message: 'Correction request submitted for review.' } };
});

export const getMyCorrections = wrap(async (req) => {
  const requests = await attService.getMyCorrectionRequests(req.user!);
  return { body: { requests } };
});

export const listAll = wrap(async (req) => {
  const attendances = await attService.listAllAttendance(req.query as any);
  return { body: { attendances } };
});

export const reviewCorrection = wrap(async (req) => {
  const { decision, notes } = req.body;
  const attendance = await attService.reviewCorrection(
    req.user!,
    req.params.id,
    decision,
    notes
  );
  return { body: { attendance, message: `Correction request has been ${decision}.` } };
});

