import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as leaveService from '../services/leave.service';

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

export const applyLeave = wrap(async (req) => {
  const result = await leaveService.applyLeave(req.user!, req.body);
  return { status: 201, body: result };
});

export const getMyLeaves = wrap(async (req) => {
  const result = await leaveService.getMyLeaves(req.user!);
  return { body: result };
});

export const cancelLeave = wrap(async (req) => {
  const leave = await leaveService.cancelLeave(req.user!, req.params.id);
  return { body: { leave, message: 'Leave request cancelled successfully.' } };
});

export const smartParse = wrap(async (req) => {
  const parsed = leaveService.smartParseLeave(req.body.text || '');
  return { body: { parsed } };
});

export const previewWorkingDays = wrap(async (req) => {
  const result = await leaveService.calculateWorkingDays(
    req.query.startDate as string,
    req.query.endDate as string,
    req.user!.tenantId
  );
  return { body: result };
});

export const listPending = wrap(async (req) => {
  const pending = await leaveService.listPendingLeaves(req.user!);
  return { body: { pending } };
});

export const listAll = wrap(async (req) => {
  const leaves = await leaveService.listAllLeaves(req.user!);
  return { body: { leaves } };
});

export const updateStatus = wrap(async (req) => {
  const { status, notes } = req.body;
  const leave = await leaveService.updateLeaveStatus(
    req.user!,
    req.params.id,
    status,
    notes
  );
  return { body: { leave, message: `Leave request has been ${status}.` } };
});
