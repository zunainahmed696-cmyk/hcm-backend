import { Request } from 'express';

export const ROLES = ['admin', 'hr', 'employee'] as const;
export type UserRole = (typeof ROLES)[number];

export interface IUser {
  _id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: JWTPayload;
}
