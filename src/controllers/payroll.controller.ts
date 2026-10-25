import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as payrollService from '../services/payroll.service';

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

export const getPayrollDraft = wrap(async (req) => {
  const month = req.query.month as string;
  const result = await payrollService.calculatePayrollRun(month, req.user!);
  return { body: result };
});

export const finalizePayroll = wrap(async (req) => {
  const { month } = req.body;
  const result = await payrollService.finalizePayrollRun(req.user!, month);
  return { body: result };
});

export const getMyPayslips = wrap(async (req) => {
  const payslips = await payrollService.getMyPayslips(req.user!);
  return { body: { payslips } };
});
