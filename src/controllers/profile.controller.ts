import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { getActorEmployee } from '../services/attendance.service';
import { updateEmployee } from '../services/employee.service';
import { getEmployeeDashboardData, getAdminDashboardData, getHRDashboardData } from '../services/dashboard.service';

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

export const getMyProfile = wrap(async (req) => {
  const employee = await getActorEmployee(req.user!);
  return { body: { employee } };
});

export const updateMyProfile = wrap(async (req) => {
  const employee = await getActorEmployee(req.user!);
  const { phone, address } = req.body;
  const updated = await updateEmployee(
    employee._id.toString(),
    { phone, address },
    req.user!
  );
  return { body: { employee: updated, message: 'Profile contact details updated successfully.' } };
});

export const getDashboard = wrap(async (req) => {
  const data = await getEmployeeDashboardData(req.user!);
  return { body: data };
});

export const getAdminDashboard = wrap(async (req) => {
  const data = await getAdminDashboardData(req.user!);
  return { body: data };
});

export const getHRDashboard = wrap(async (req) => {
  const data = await getHRDashboardData(req.user!);
  return { body: data };
});
