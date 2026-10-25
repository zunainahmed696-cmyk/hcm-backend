import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as org from '../services/org.service';
import * as users from '../services/user.service';

type Handler = (req: AuthRequest) => Promise<{ status?: number; body: object }>;

/** Wraps a service call: sends `{ success: true, ...body }` or forwards errors to the error middleware. */
const wrap = (fn: Handler) => async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status = 200, body } = await fn(req);
    res.status(status).json({ success: true, ...body });
  } catch (error) {
    next(error);
  }
};

// Settings (scoped to tenant)
export const getSettings = wrap(async (req) => ({ body: { settings: await org.getSettings(req.user!) } }));
export const updateSettings = wrap(async (req) => ({ body: { settings: await org.updateSettings(req.body, req.user!) } }));

// Catalogs (departments, designations, leave-types, holidays)
export const listCatalog = wrap(async (req) => ({ body: { items: await org.listCatalog(req.params.entity, req.user!) } }));
export const createCatalogItem = wrap(async (req) => ({ status: 201, body: { item: await org.createCatalogItem(req.params.entity, req.body, req.user!) } }));
export const updateCatalogItem = wrap(async (req) => ({ body: { item: await org.updateCatalogItem(req.params.entity, req.params.id, req.body, req.user!) } }));
export const deleteCatalogItem = wrap(async (req) => {
  await org.deleteCatalogItem(req.params.entity, req.params.id, req.user!);
  return { body: { message: 'Deleted' } };
});

// Users (Admin only, scoped to tenant)
export const listUsers = wrap(async (req) => ({ body: { users: await users.listUsers(req.user!, req.query.role as string | undefined) } }));
export const createHr = wrap(async (req) => ({ status: 201, body: await users.createHrUser(req.body, req.user!) }));
export const setActive = wrap(async (req) => ({ body: { user: await users.setUserActive(req.params.id, req.body.isActive, req.user!) } }));
export const resetPassword = wrap(async (req) => ({ body: await users.resetUserPassword(req.params.id, req.user!) }));

// Shift Assignment (HR & Admin, scoped to tenant)
export const getShifts = wrap(async (req) => ({ body: await org.getShiftAssignments(req.user!) }));
export const assignDeptShift = wrap(async (req) => {
  const result = await org.assignDepartmentShift(req.user!, req.body);
  return {
    body: {
      ...result,
      message: `Assigned "${result.shiftName}" (${result.shiftStart} – ${result.shiftEnd}) to ${result.department} (${result.updatedEmployeesCount} employee(s) updated).`,
    },
  };
});
export const assignEmpShift = wrap(async (req) => {
  const emp = await org.assignEmployeeShift(req.user!, req.params.id, req.body);
  return {
    body: {
      employee: emp,
      message: `Assigned "${emp.shiftName}" (${emp.shiftStart} – ${emp.shiftEnd}) to ${emp.name} (${emp.employeeId}).`,
    },
  };
});
