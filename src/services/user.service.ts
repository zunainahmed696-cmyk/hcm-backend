import crypto from 'crypto';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';
import { recordAudit } from './audit.service';
import { toPublicUser } from './auth.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Readable temporary password, shown to the creator once. */
export const generateTempPassword = (): string => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('');
};

export const listUsers = async (role?: string) => {
  const filter = role ? { role } : {};
  const users = await User.find(filter).sort({ createdAt: -1 });
  return users.map(toPublicUser);
};

/** Admin creates an HR login with a temporary password (must be changed on first sign-in). */
export const createHrUser = async (body: { name?: unknown; email?: unknown }, actor: JWTPayload) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name) throw new AppError('Name is required.', 422);
  if (!EMAIL_RE.test(email)) throw new AppError('A valid email is required.', 422);
  if (await User.exists({ email })) throw new AppError('A user with this email already exists.', 409);

  const tempPassword = generateTempPassword();
  const user = await User.create({ name, email, password: tempPassword, role: 'hr', mustChangePassword: true });
  await recordAudit({ actor, action: 'CREATE', entity: 'User', entityId: user._id.toString(), after: { name, email, role: 'hr' } });
  return { user: toPublicUser(user), tempPassword };
};

const getManageableUser = async (id: string, actor: JWTPayload) => {
  const user = await User.findById(id);
  if (!user) throw new AppError('User not found.', 404);
  if (user.role === 'admin') throw new AppError('Admin accounts cannot be changed here.', 403);
  if (user._id.toString() === actor.userId) throw new AppError('You cannot change your own account.', 403);
  return user;
};

export const setUserActive = async (id: string, isActive: unknown, actor: JWTPayload) => {
  if (typeof isActive !== 'boolean') throw new AppError('isActive must be true or false.', 422);
  const user = await getManageableUser(id, actor);
  const before = { isActive: user.isActive };
  user.isActive = isActive;
  await user.save();
  await recordAudit({ actor, action: isActive ? 'ACTIVATE' : 'DEACTIVATE', entity: 'User', entityId: id, before, after: { isActive } });
  return toPublicUser(user);
};

export const resetUserPassword = async (id: string, actor: JWTPayload) => {
  const user = await getManageableUser(id, actor);
  const tempPassword = generateTempPassword();
  user.password = tempPassword;
  user.mustChangePassword = true;
  await user.save();
  await recordAudit({ actor, action: 'RESET_PASSWORD', entity: 'User', entityId: id });
  return { user: toPublicUser(user), tempPassword };
};
