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

// Settings
export const getSettings = wrap(async () => ({ body: { settings: await org.getSettings() } }));
export const updateSettings = wrap(async (req) => ({ body: { settings: await org.updateSettings(req.body, req.user!) } }));

// Catalogs (departments, designations, leave-types, holidays)
export const listCatalog = wrap(async (req) => ({ body: { items: await org.listCatalog(req.params.entity) } }));
export const createCatalogItem = wrap(async (req) => ({ status: 201, body: { item: await org.createCatalogItem(req.params.entity, req.body, req.user!) } }));
export const updateCatalogItem = wrap(async (req) => ({ body: { item: await org.updateCatalogItem(req.params.entity, req.params.id, req.body, req.user!) } }));
export const deleteCatalogItem = wrap(async (req) => {
  await org.deleteCatalogItem(req.params.entity, req.params.id, req.user!);
  return { body: { message: 'Deleted' } };
});

// Users (Admin only)
export const listUsers = wrap(async (req) => ({ body: { users: await users.listUsers(req.query.role as string | undefined) } }));
export const createHr = wrap(async (req) => ({ status: 201, body: await users.createHrUser(req.body, req.user!) }));
export const setActive = wrap(async (req) => ({ body: { user: await users.setUserActive(req.params.id, req.body.isActive, req.user!) } }));
export const resetPassword = wrap(async (req) => ({ body: await users.resetUserPassword(req.params.id, req.user!) }));
