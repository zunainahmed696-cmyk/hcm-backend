import { Model } from 'mongoose';
import { Department, Designation, LeaveType, Holiday } from '../models/Org';
import { Settings } from '../models/Settings';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';
import { recordAudit } from './audit.service';

type Body = Record<string, unknown>;

interface CatalogConfig {
  label: string;
  model: Model<any>;
  sort: Record<string, 1 | -1>;
  /** Validates + normalizes the request body. Throws AppError(422) on bad input. */
  parse: (body: Body) => Body;
}

const requireName = (body: Body, label: string): string => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new AppError(`${label} name is required.`, 422);
  if (name.length > 80) throw new AppError(`${label} name is too long (max 80).`, 422);
  return name;
};

const isValidIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const CATALOGS: Record<string, CatalogConfig> = {
  departments: { label: 'Department', model: Department, sort: { name: 1 }, parse: (b) => ({ name: requireName(b, 'Department') }) },
  designations: { label: 'Designation', model: Designation, sort: { name: 1 }, parse: (b) => ({ name: requireName(b, 'Designation') }) },
  'leave-types': {
    label: 'Leave type',
    model: LeaveType,
    sort: { name: 1 },
    parse: (b) => {
      const unlimited = b.unlimited === true;
      const quota = unlimited ? 0 : Number(b.annualQuota);
      if (!unlimited && (!Number.isFinite(quota) || quota < 0 || quota > 366)) {
        throw new AppError('Annual quota must be a number between 0 and 366.', 422);
      }
      return { name: requireName(b, 'Leave type'), annualQuota: quota, unlimited, isPaid: b.isPaid !== false };
    },
  },
  holidays: {
    label: 'Holiday',
    model: Holiday,
    sort: { date: 1 },
    parse: (b) => {
      if (!isValidIsoDate(b.date)) throw new AppError('Holiday date must be a valid date (YYYY-MM-DD).', 422);
      return { name: requireName(b, 'Holiday'), date: b.date };
    },
  },
};

const getCatalog = (entity: string): CatalogConfig => {
  const cfg = CATALOGS[entity];
  if (!cfg) throw new AppError('Unknown catalog.', 404);
  return cfg;
};

const withDuplicateMessage = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.code === 11000) throw new AppError(`${label} already exists.`, 409);
    throw err;
  }
};

export const listCatalog = async (entity: string) => {
  const cfg = getCatalog(entity);
  return cfg.model.find().sort(cfg.sort).lean();
};

export const createCatalogItem = async (entity: string, body: Body, actor: JWTPayload) => {
  const cfg = getCatalog(entity);
  const data = cfg.parse(body);
  const doc = await withDuplicateMessage(cfg.label, () => cfg.model.create(data));
  await recordAudit({ actor, action: 'CREATE', entity: cfg.label, entityId: doc._id.toString(), after: data });
  return doc;
};

export const updateCatalogItem = async (entity: string, id: string, body: Body, actor: JWTPayload) => {
  const cfg = getCatalog(entity);
  const data = cfg.parse(body);
  const before = await cfg.model.findById(id).lean();
  if (!before) throw new AppError(`${cfg.label} not found.`, 404);
  const doc = await withDuplicateMessage(cfg.label, () => cfg.model.findByIdAndUpdate(id, data, { new: true, runValidators: true }));
  await recordAudit({ actor, action: 'UPDATE', entity: cfg.label, entityId: id, before, after: data });
  return doc;
};

export const deleteCatalogItem = async (entity: string, id: string, actor: JWTPayload) => {
  const cfg = getCatalog(entity);
  const before = await cfg.model.findByIdAndDelete(id).lean();
  if (!before) throw new AppError(`${cfg.label} not found.`, 404);
  await recordAudit({ actor, action: 'DELETE', entity: cfg.label, entityId: id, before });
};

// ---- Company settings (singleton) ----

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const inRange = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

export const getSettings = async () => {
  const s = await Settings.findOne().lean();
  if (!s) throw new AppError('Company is not set up yet.', 404);
  return s;
};

export const updateSettings = async (body: Body, actor: JWTPayload) => {
  const current = await Settings.findOne();
  if (!current) throw new AppError('Company is not set up yet.', 404);
  const before = current.toObject();
  const update: Body = {};

  if (body.companyName !== undefined) update.companyName = requireName({ name: body.companyName }, 'Company');
  if (body.officeStart !== undefined) {
    if (typeof body.officeStart !== 'string' || !HHMM.test(body.officeStart)) throw new AppError('Office start must be HH:mm.', 422);
    update.officeStart = body.officeStart;
  }
  if (body.graceMinutes !== undefined) {
    if (!inRange(body.graceMinutes, 0, 120)) throw new AppError('Grace time must be 0-120 minutes.', 422);
    update.graceMinutes = body.graceMinutes;
  }
  if (body.halfDayHours !== undefined) {
    if (!inRange(body.halfDayHours, 1, 12)) throw new AppError('Half-day threshold must be 1-12 hours.', 422);
    update.halfDayHours = body.halfDayHours;
  }
  if (body.weekend !== undefined) {
    const w = body.weekend;
    if (!Array.isArray(w) || w.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || w.length > 6) {
      throw new AppError('Weekend must list 0-6 weekday numbers (0 = Sunday).', 422);
    }
    update.weekend = [...new Set(w as number[])].sort();
  }
  if (body.office !== undefined) {
    const o = body.office as Body;
    const hasCoords = o && o.lat !== null && o.lat !== undefined && o.lng !== null && o.lng !== undefined;
    if (hasCoords && (!inRange(o.lat, -90, 90) || !inRange(o.lng, -180, 180))) throw new AppError('Office latitude/longitude are out of range.', 422);
    if (o?.radiusMeters !== undefined && !inRange(o.radiusMeters, 10, 5000)) throw new AppError('Radius must be 10-5000 meters.', 422);
    update.office = {
      lat: hasCoords ? o.lat : null,
      lng: hasCoords ? o.lng : null,
      radiusMeters: o?.radiusMeters ?? before.office?.radiusMeters ?? 150,
    };
  }

  current.set(update);
  await current.save();
  await recordAudit({ actor, action: 'UPDATE', entity: 'Settings', entityId: current._id.toString(), before, after: current.toObject() });
  return current.toObject();
};
