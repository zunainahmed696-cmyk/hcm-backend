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

export const requestClockOutReset = wrap(async (req) => {
  const attendance = await attService.requestClockOutReset(req.user!, req.body);
  return {
    status: 201,
    body: {
      attendance,
      message: 'Clock-out reset application submitted to HR & Owner for review.',
    },
  };
});

export const resetClockOut = wrap(async (req) => {
  const { decision, notes } = req.body;
  const attendance = await attService.resetEmployeeClockOut(req.user!, req.params.id, {
    decision,
    notes,
  });
  const msg =
    decision === 'rejected'
      ? 'Clock-out reset application declined.'
      : 'Employee clock-out has been reset. Their shift is now active again.';
  return { body: { attendance, message: msg } };
});

export const resetClockOutByBody = wrap(async (req) => {
  const { attendanceId, employeeId, date, decision, notes } = req.body;
  const attendance = await attService.resetClockOutByEmployeeOrId(req.user!, {
    attendanceId,
    employeeId,
    date,
    decision,
    notes,
  });
  return {
    body: {
      attendance,
      message: 'Employee clock-out has been reset. Their shift is now active again.',
    },
  };
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
  const requests = await attService.getMyCorrectionRequests(req.user!, req.query.status as string);
  return { body: { requests } };
});

export const getDailyBoard = wrap(async (req) => {
  const board = await attService.getDailyBoard(req.user!, req.query as any);
  return { body: board };
});

export const overrideAttendance = wrap(async (req) => {
  const attendance = await attService.overrideAttendance(req.user!, req.body);
  return { body: { attendance, message: 'Attendance record overridden successfully.' } };
});

export const listAll = wrap(async (req) => {
  const attendances = await attService.listAllAttendance(req.query as any, req.user!);
  return { body: { attendances } };
});

export const reviewCorrection = wrap(async (req) => {
  const decision = req.body.decision || req.body.status || 'approved';
  const notes = req.body.notes ?? req.body.reviewNotes;
  const attendance = await attService.reviewCorrection(
    req.user!,
    req.params.id,
    decision,
    notes
  );
  return {
    body: {
      attendance,
      message: `Application has been ${String(decision).toLowerCase()}.`,
    },
  };
});
