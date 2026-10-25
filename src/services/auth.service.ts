import jwt from 'jsonwebtoken';
import { User, IUserDocument } from '../models/User';
import { Settings } from '../models/Settings';
import { Department, Designation, LeaveType } from '../models/Org';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';
import { recordAudit } from './audit.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getJwtSecret = (): string =>
  process.env.JWT_SECRET || 'super_secret_hackathon_jwt_key_2026_change_in_production';

export const signToken = (user: IUserDocument): string => {
  const payload: JWTPayload = {
    userId: user._id.toString(),
    tenantId: user.tenantId?.toString() || '',
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
};

export const toPublicUser = (user: IUserDocument) => ({
  id: user._id,
  tenantId: user.tenantId?.toString() || '',
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  mustChangePassword: user.mustChangePassword,
  createdAt: user.createdAt,
});

const assertPassword = (password: unknown): string => {
  if (typeof password !== 'string' || password.length < 8) {
    throw new AppError('Password must be at least 8 characters.', 422);
  }
  return password;
};

export const isSetupComplete = async (): Promise<boolean> => (await Settings.countDocuments()) > 0;

export interface SetupInput {
  companyName?: string;
  officeStart?: string;
  graceMinutes?: number;
  halfDayHours?: number;
  weekend?: number[];
  office?: {
    address?: string;
    lat?: number | null;
    lng?: number | null;
    radiusMeters?: number;
  };
  adminName?: string;
  email?: string;
  password?: string;
}

/** Seeds starter departments, designations, and leave types for a tenant */
export const seedTenantCatalogs = async (tenantId: any) => {
  const starterDepts = ['Engineering', 'Human Resources', 'Operations', 'Finance'];
  for (const d of starterDepts) {
    await Department.findOneAndUpdate(
      { tenantId, name: d },
      { tenantId, name: d },
      { upsert: true }
    );
  }

  const starterDesigs = [
    { name: 'Senior Software Engineer' },
    { name: 'HR Officer' },
    { name: 'Operations Specialist' },
    { name: 'Financial Analyst' },
  ];
  for (const des of starterDesigs) {
    await Designation.findOneAndUpdate(
      { tenantId, name: des.name },
      { tenantId, ...des },
      { upsert: true }
    );
  }

  const starterLeaves = [
    { name: 'Annual', annualQuota: 14, unlimited: false, isPaid: true },
    { name: 'Sick', annualQuota: 8, unlimited: false, isPaid: true },
    { name: 'Casual', annualQuota: 10, unlimited: false, isPaid: true },
    { name: 'Unpaid', annualQuota: 0, unlimited: true, isPaid: false },
  ];
  for (const lt of starterLeaves) {
    await LeaveType.findOneAndUpdate(
      { tenantId, name: lt.name },
      { tenantId, ...lt },
      { upsert: true }
    );
  }
};

/** Company setup (functionality #01): creates a new isolated Tenant (Settings) + Master Admin + starter catalogs. */
export const runFirstSetup = async (input: SetupInput) => {
  const companyName = input.companyName?.trim();
  const adminName = input.adminName?.trim() || 'Admin';
  const email = input.email?.trim().toLowerCase();
  if (!companyName) throw new AppError('Company name is required.', 422);
  if (!email || !EMAIL_RE.test(email)) throw new AppError('A valid admin email is required.', 422);
  const password = assertPassword(input.password);

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('An account with this email address already exists. Please sign in instead.', 409);
  }

  const hasCoords =
    input.office?.lat !== undefined &&
    input.office?.lat !== null &&
    input.office?.lng !== undefined &&
    input.office?.lng !== null;

  // 1. Create a new tenant Settings document for this company
  const settings = await Settings.create({
    companyName,
    officeStart: input.officeStart?.trim() || '09:00',
    graceMinutes: input.graceMinutes !== undefined ? Number(input.graceMinutes) : 15,
    halfDayHours: input.halfDayHours !== undefined ? Number(input.halfDayHours) : 5,
    weekend: Array.isArray(input.weekend) && input.weekend.length > 0 ? input.weekend : [0, 6],
    office: {
      address: typeof input.office?.address === 'string' ? input.office.address.trim() : (hasCoords ? 'Karachi, Pakistan' : ''),
      lat: hasCoords ? Number(input.office!.lat) : null,
      lng: hasCoords ? Number(input.office!.lng) : null,
      radiusMeters: input.office?.radiusMeters !== undefined ? Number(input.office.radiusMeters) : 150,
    },
  });

  const tenantId = settings._id;

  // 2. Create Master Administrator account bound to this tenant
  const admin = await User.create({
    tenantId,
    name: adminName,
    email,
    password,
    role: 'admin',
    isActive: true,
    mustChangePassword: false,
  });

  // 3. Provision standard starter departments, designations, and leave types for this tenant
  await seedTenantCatalogs(tenantId);

  await recordAudit({
    actor: { userId: admin._id.toString(), tenantId: tenantId.toString(), email: admin.email, role: 'admin' },
    action: 'SETUP',
    entity: 'Company',
    after: { companyName, adminEmail: email, officeStart: settings.officeStart, office: settings.office },
  });

  return admin;
};

export const authenticateUser = async (emailRaw: unknown, password: unknown): Promise<IUserDocument> => {
  if (typeof emailRaw !== 'string' || typeof password !== 'string' || !emailRaw || !password) {
    throw new AppError('Please provide both email and password.', 400);
  }
  const user = await User.findOne({ email: emailRaw.trim().toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) throw new AppError('Invalid email or password.', 401);
  if (!user.isActive) throw new AppError('This account has been deactivated. Contact your administrator.', 403);
  return user;
};

export const changeUserPassword = async (userId: string, currentPassword: unknown, newPassword: unknown) => {
  const next = assertPassword(newPassword);
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AppError('User not found.', 404);
  if (typeof currentPassword !== 'string' || !(await user.comparePassword(currentPassword))) {
    throw new AppError('Current password is incorrect.', 401);
  }
  if (currentPassword === next) throw new AppError('New password must be different from the current one.', 422);

  user.password = next;
  user.mustChangePassword = false;
  await user.save();
  await recordAudit({
    actor: { userId, tenantId: user.tenantId?.toString() || '', email: user.email, role: user.role },
    action: 'CHANGE_PASSWORD',
    entity: 'User',
    entityId: userId,
  });
  return user;
};

/** Env-based first run: creates company + admin from ADMIN_EMAIL / ADMIN_PASSWORD when the DB is empty. */
export const bootstrapFromEnv = async (): Promise<void> => {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, COMPANY_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || (await isSetupComplete())) return;
  await runFirstSetup({
    companyName: COMPANY_NAME || 'My Company',
    adminName: 'Admin',
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  console.log(`[Setup] Admin created from environment: ${ADMIN_EMAIL}`);
};
