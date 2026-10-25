import { Model } from 'mongoose';
import { Department, Designation, LeaveType, Holiday } from '../models/Org';
import { Employee } from '../models/Employee';
import { Notification } from '../models/Notification';
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

export const listCatalog = async (entity: string, actor: JWTPayload) => {
  const cfg = getCatalog(entity);
  return cfg.model.find({ tenantId: actor.tenantId }).sort(cfg.sort).lean();
};

export const createCatalogItem = async (entity: string, body: Body, actor: JWTPayload) => {
  const cfg = getCatalog(entity);
  const data = { ...cfg.parse(body), tenantId: actor.tenantId };
  const doc = await withDuplicateMessage(cfg.label, () => cfg.model.create(data));
  await recordAudit({ actor, action: 'CREATE', entity: cfg.label, entityId: doc._id.toString(), after: data });
  return doc;
};

export const updateCatalogItem = async (entity: string, id: string, body: Body, actor: JWTPayload) => {
  const cfg = getCatalog(entity);
  const data = cfg.parse(body);
  const before = await cfg.model.findOne({ _id: id, tenantId: actor.tenantId }).lean();
  if (!before) throw new AppError(`${cfg.label} not found.`, 404);
  const doc = await withDuplicateMessage(cfg.label, () =>
    cfg.model.findOneAndUpdate({ _id: id, tenantId: actor.tenantId }, data, { new: true, runValidators: true })
  );
  await recordAudit({ actor, action: 'UPDATE', entity: cfg.label, entityId: id, before, after: data });
  return doc;
};

export const deleteCatalogItem = async (entity: string, id: string, actor: JWTPayload) => {
  const cfg = getCatalog(entity);
  const before = await cfg.model.findOneAndDelete({ _id: id, tenantId: actor.tenantId }).lean();
  if (!before) throw new AppError(`${cfg.label} not found.`, 404);
  await recordAudit({ actor, action: 'DELETE', entity: cfg.label, entityId: id, before });
};

// ---- Company settings (scoped per tenant) ----

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const inRange = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

export const getSettings = async (actor: JWTPayload) => {
  const s = await Settings.findById(actor.tenantId).lean();
  if (!s) throw new AppError('Company is not set up yet.', 404);
  return s;
};

export const updateSettings = async (body: Body, actor: JWTPayload) => {
  const current = await Settings.findById(actor.tenantId);
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
      address: typeof o?.address === 'string' ? o.address.trim() : (hasCoords ? (before.office?.address || '') : ''),
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

// ---- Shift Assignment (HR & Admin, scoped per tenant) ----

export const getShiftAssignments = async (actor: JWTPayload) => {
  const [departments, employees, settings] = await Promise.all([
    Department.find({ tenantId: actor.tenantId }).sort({ name: 1 }).lean(),
    Employee.find({
      tenantId: actor.tenantId,
      role: { $ne: 'admin' },
      status: { $ne: 'inactive' },
    })
      .select('employeeId name email department designation role status shiftName shiftStart shiftEnd shiftGraceMinutes')
      .sort({ department: 1, employeeId: 1 })
      .lean(),
    Settings.findById(actor.tenantId).lean(),
  ]);

  const defaultStart = settings?.officeStart || '09:00';
  const defaultGrace = settings?.graceMinutes ?? 15;

  return {
    departments: departments.map((d: any) => ({
      _id: d._id.toString(),
      name: d.name,
      shiftName: d.shiftName || 'Morning Shift',
      shiftStart: d.shiftStart || defaultStart,
      shiftEnd: d.shiftEnd || '17:00',
      shiftGraceMinutes: d.shiftGraceMinutes ?? defaultGrace,
    })),
    employees: employees.map((e: any) => ({
      _id: e._id.toString(),
      employeeId: e.employeeId,
      name: e.name,
      email: e.email,
      department: e.department,
      designation: e.designation,
      role: e.role,
      status: e.status,
      shiftName: e.shiftName || 'Morning Shift',
      shiftStart: e.shiftStart || defaultStart,
      shiftEnd: e.shiftEnd || '17:00',
      shiftGraceMinutes: e.shiftGraceMinutes ?? defaultGrace,
    })),
    defaultSettings: {
      officeStart: defaultStart,
      graceMinutes: defaultGrace,
    },
  };
};

export const assignDepartmentShift = async (
  actor: JWTPayload,
  input: {
    department: string;
    shiftName: string;
    shiftStart: string;
    shiftEnd: string;
    shiftGraceMinutes?: number;
  }
) => {
  const deptName = (input.department || '').trim();
  const shiftName = (input.shiftName || 'Morning Shift').trim();
  const shiftStart = (input.shiftStart || '09:00').trim();
  const shiftEnd = (input.shiftEnd || '17:00').trim();
  const shiftGraceMinutes = Number.isFinite(Number(input.shiftGraceMinutes))
    ? Math.max(0, Math.min(120, Number(input.shiftGraceMinutes)))
    : 15;

  if (!deptName) throw new AppError('Department name is required.', 422);
  if (!HHMM.test(shiftStart)) throw new AppError('Shift start time must be in HH:mm format.', 422);
  if (!HHMM.test(shiftEnd)) throw new AppError('Shift end time must be in HH:mm format.', 422);

  await Department.findOneAndUpdate(
    { tenantId: actor.tenantId, name: deptName },
    {
      $set: {
        shiftName,
        shiftStart,
        shiftEnd,
        shiftGraceMinutes,
      },
    }
  );

  const affectedEmployees = await Employee.find({
    tenantId: actor.tenantId,
    department: deptName,
    role: { $ne: 'admin' },
  });

  await Employee.updateMany(
    { tenantId: actor.tenantId, department: deptName, role: { $ne: 'admin' } },
    {
      $set: {
        shiftName,
        shiftStart,
        shiftEnd,
        shiftGraceMinutes,
      },
    }
  );

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'DepartmentShift',
    entityId: deptName,
    after: {
      department: deptName,
      shiftName,
      shiftStart,
      shiftEnd,
      shiftGraceMinutes,
      updatedEmployeesCount: affectedEmployees.length,
    },
  });

  // Notify affected employees
  try {
    await Promise.all(
      affectedEmployees
        .filter((e) => e.userId)
        .map((e) =>
          Notification.create({
            tenantId: actor.tenantId as any,
            type: 'notification',
            title: `Shift Assigned: ${shiftName}`,
            message: `Your department (${deptName}) shift has been updated to ${shiftName} (${shiftStart} – ${shiftEnd}, +${shiftGraceMinutes}m grace).`,
            category: 'attendance',
            priority: 'normal',
            recipientUserId: e.userId,
            senderName: actor.role === 'hr' ? 'HR Operations' : 'Company Owner',
            link: '/clockin-out',
          })
        )
    );
  } catch {
    // Non-blocking notification
  }

  return {
    department: deptName,
    shiftName,
    shiftStart,
    shiftEnd,
    shiftGraceMinutes,
    updatedEmployeesCount: affectedEmployees.length,
  };
};

export const assignEmployeeShift = async (
  actor: JWTPayload,
  employeeIdOrDocId: string,
  input: {
    shiftName: string;
    shiftStart: string;
    shiftEnd: string;
    shiftGraceMinutes?: number;
  }
) => {
  const shiftName = (input.shiftName || 'Morning Shift').trim();
  const shiftStart = (input.shiftStart || '09:00').trim();
  const shiftEnd = (input.shiftEnd || '17:00').trim();
  const shiftGraceMinutes = Number.isFinite(Number(input.shiftGraceMinutes))
    ? Math.max(0, Math.min(120, Number(input.shiftGraceMinutes)))
    : 15;

  if (!HHMM.test(shiftStart)) throw new AppError('Shift start time must be in HH:mm format.', 422);
  if (!HHMM.test(shiftEnd)) throw new AppError('Shift end time must be in HH:mm format.', 422);

  const isMongoId = /^[0-9a-fA-F]{24}$/.test(employeeIdOrDocId);
  const employee = await Employee.findOne({
    tenantId: actor.tenantId,
    $or: [
      { employeeId: employeeIdOrDocId.toUpperCase() },
      ...(isMongoId ? [{ _id: employeeIdOrDocId }] : []),
    ],
  });

  if (!employee) throw new AppError('Employee not found.', 404);

  const before = {
    shiftName: employee.shiftName,
    shiftStart: employee.shiftStart,
    shiftEnd: employee.shiftEnd,
    shiftGraceMinutes: employee.shiftGraceMinutes,
  };

  employee.shiftName = shiftName;
  employee.shiftStart = shiftStart;
  employee.shiftEnd = shiftEnd;
  employee.shiftGraceMinutes = shiftGraceMinutes;
  await employee.save();

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'EmployeeShift',
    entityId: employee.employeeId,
    before,
    after: {
      employeeId: employee.employeeId,
      name: employee.name,
      shiftName,
      shiftStart,
      shiftEnd,
      shiftGraceMinutes,
    },
  });

  if (employee.userId) {
    try {
      await Notification.create({
        tenantId: actor.tenantId as any,
        type: 'notification',
        title: `New Shift Assigned: ${shiftName}`,
        message: `Your personal work shift has been assigned as ${shiftName} (${shiftStart} – ${shiftEnd}, +${shiftGraceMinutes}m grace).`,
        category: 'attendance',
        priority: 'normal',
        recipientUserId: employee.userId,
        senderName: actor.role === 'hr' ? 'HR Operations' : 'Company Owner',
        link: '/clockin-out',
      });
    } catch {
      // Non-blocking notification
    }
  }

  return employee;
};
