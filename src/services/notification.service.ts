import Notification, { AnnouncementScope, NotificationPriority } from '../models/Notification';
import { Employee } from '../models/Employee';
import { User } from '../models/User';
import { recordAudit } from './audit.service';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';

export const getMyInbox = async (actor: JWTPayload) => {
  // Check if any notifications exist for this tenant; if none, seed default welcoming company announcements
  const count = await Notification.countDocuments({ tenantId: actor.tenantId });
  if (count === 0) {
    await Notification.create([
      {
        tenantId: actor.tenantId as any,
        type: 'announcement',
        title: 'Welcome to HCM Lite Enterprise Portal',
        message:
          'Welcome to the modern workforce operations portal. Review your attendance, track office hours, submit leave requests, and explore your Employee 360 profile.',
        category: 'general',
        priority: 'high',
        targetScope: 'everyone',
        senderName: 'Company Owner',
      },
      {
        tenantId: actor.tenantId as any,
        type: 'announcement',
        title: 'Attendance & Grace Period Policy Reminder',
        message:
          'Standard office hours begin at 09:00 AM with a 15-minute grace period. Check-ins after 09:15 AM are automatically marked as Late. Workdays under 5 hours are recorded as half-days.',
        category: 'attendance',
        priority: 'normal',
        targetScope: 'everyone',
        senderName: 'Company Owner',
      },
    ]);
  }

  let queryFilter: Record<string, any>;

  if (actor.role === 'admin') {
    // Owner sees all announcements in their tenant + notifications addressed to the Owner
    queryFilter = {
      tenantId: actor.tenantId,
      $or: [
        { type: 'announcement' },
        { type: 'notification', recipientUserId: actor.userId },
      ],
    };
  } else {
    // Employee or HR: strictly filter announcements by targetScope (everyone, caller's department, or caller's employeeId)
    // and notifications strictly by recipientUserId === actor.userId
    const callerEmp = await Employee.findOne({
      tenantId: actor.tenantId,
      $or: [{ userId: actor.userId }, { email: actor.email }],
    })
      .select('employeeId department')
      .lean();

    const callerDept = callerEmp?.department || '';
    const callerEmpId = callerEmp?.employeeId || '';

    const announcementOrConditions: any[] = [
      { targetScope: 'everyone' },
      { targetScope: { $exists: false }, recipientUserId: null },
      { targetScope: null, recipientUserId: null },
    ];

    if (callerDept) {
      announcementOrConditions.push({
        targetScope: 'department',
        targetDepartment: callerDept,
      });
    }

    if (callerEmpId) {
      announcementOrConditions.push({
        targetScope: 'employee',
        targetEmployeeId: callerEmpId,
      });
    }

    announcementOrConditions.push({
      targetScope: 'employee',
      recipientUserId: actor.userId,
    });

    queryFilter = {
      tenantId: actor.tenantId,
      $or: [
        {
          type: 'announcement',
          $or: announcementOrConditions,
        },
        {
          type: 'notification',
          recipientUserId: actor.userId,
        },
      ],
    };
  }

  const items = await Notification.find(queryFilter).sort({ createdAt: -1 });

  const userIdStr = String(actor.userId);
  const formatted = items.map((item) => {
    const isRead = item.readBy.some((id) => String(id) === userIdStr);
    return {
      id: item._id.toString(),
      _id: item._id.toString(),
      type: item.type,
      title: item.title,
      message: item.message,
      category: item.category,
      priority: item.priority,
      targetScope: item.targetScope || 'everyone',
      targetDepartment: item.targetDepartment || null,
      targetEmployeeId: item.targetEmployeeId || null,
      senderName: item.senderName,
      createdAt: item.createdAt,
      isRead,
      link: item.link,
    };
  });

  const unreadCount = formatted.filter((f) => !f.isRead).length;
  const announcements = formatted.filter((f) => f.type === 'announcement');
  const notifications = formatted.filter((f) => f.type === 'notification');

  return { items: formatted, announcements, notifications, unreadCount };
};

/**
 * Only the Company Owner (role === 'admin') can create announcements, scoped to:
 * - 'everyone' (all employees in the tenant)
 * - 'department' (only employees in targetDepartment)
 * - 'employee' (only the specific targetEmployeeId)
 */
export const createAnnouncement = async (
  actor: JWTPayload,
  input: {
    title: string;
    message: string;
    category?: 'system' | 'leave' | 'attendance' | 'payroll' | 'general';
    priority?: NotificationPriority;
    targetScope?: AnnouncementScope;
    targetDepartment?: string;
    targetEmployeeId?: string;
  }
) => {
  if (actor.role !== 'admin') {
    throw new AppError('Only the Company Owner (Admin) is authorized to create announcements.', 403);
  }

  const title = (input.title || '').trim();
  const message = (input.message || '').trim();
  if (!title) throw new AppError('Announcement title is required.', 422);
  if (title.length > 120) throw new AppError('Announcement title cannot exceed 120 characters.', 422);
  if (!message) throw new AppError('Announcement message body is required.', 422);

  const targetScope: AnnouncementScope =
    input.targetScope === 'department' || input.targetScope === 'employee'
      ? input.targetScope
      : 'everyone';

  let targetDepartment: string | null = null;
  let targetEmployeeId: string | null = null;
  let recipientUserId: any = null;

  if (targetScope === 'department') {
    targetDepartment = (input.targetDepartment || '').trim();
    if (!targetDepartment) {
      throw new AppError('Please select a target department for this announcement.', 422);
    }
  } else if (targetScope === 'employee') {
    const empCode = (input.targetEmployeeId || '').trim().toUpperCase();
    if (!empCode) {
      throw new AppError('Please select a target employee for this announcement.', 422);
    }
    const emp = await Employee.findOne({
      tenantId: actor.tenantId,
      employeeId: empCode,
      role: { $ne: 'admin' },
    }).lean();
    if (!emp) {
      throw new AppError(`Employee '${empCode}' was not found in your organization.`, 404);
    }
    targetEmployeeId = emp.employeeId;
    recipientUserId = emp.userId || null;
  }

  const ownerUser = await User.findById(actor.userId).select('name').lean();
  const senderName = ownerUser?.name ? `${ownerUser.name} (Owner)` : 'Company Owner';

  const doc = await Notification.create({
    tenantId: actor.tenantId as any,
    type: 'announcement',
    title,
    message,
    category: input.category || 'general',
    priority: input.priority || 'normal',
    targetScope,
    targetDepartment,
    targetEmployeeId,
    recipientUserId,
    senderName,
    readBy: [actor.userId as any],
  });

  await recordAudit({
    actor,
    action: 'CREATE',
    entity: 'Announcement',
    entityId: doc._id.toString(),
    after: {
      title,
      category: doc.category,
      priority: doc.priority,
      targetScope,
      targetDepartment,
      targetEmployeeId,
    },
  });

  return {
    id: doc._id.toString(),
    _id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    category: doc.category,
    priority: doc.priority,
    targetScope: doc.targetScope,
    targetDepartment: doc.targetDepartment,
    targetEmployeeId: doc.targetEmployeeId,
    senderName: doc.senderName,
    createdAt: doc.createdAt,
    isRead: true,
  };
};

export const deleteAnnouncement = async (actor: JWTPayload, id: string) => {
  if (actor.role !== 'admin') {
    throw new AppError('Only the Company Owner can delete announcements.', 403);
  }
  const deleted = await Notification.findOneAndDelete({
    _id: id,
    tenantId: actor.tenantId,
    type: 'announcement',
  });
  if (!deleted) {
    throw new AppError('Announcement not found.', 404);
  }
  await recordAudit({
    actor,
    action: 'DELETE',
    entity: 'Announcement',
    entityId: id,
    before: { title: deleted.title, targetScope: deleted.targetScope },
  });
  return { deleted: true };
};

export const markAsRead = async (actor: JWTPayload, id: string) => {
  const item = await Notification.findOne({ _id: id, tenantId: actor.tenantId });
  if (!item) return null;

  const userIdStr = String(actor.userId);
  if (!item.readBy.some((readId) => String(readId) === userIdStr)) {
    item.readBy.push(actor.userId as any);
    await item.save();
  }
  return item;
};

export const markAllAsRead = async (actor: JWTPayload) => {
  const items = await Notification.find({
    tenantId: actor.tenantId,
  });

  const userIdStr = String(actor.userId);
  await Promise.all(
    items.map(async (item) => {
      if (!item.readBy.some((readId) => String(readId) === userIdStr)) {
        item.readBy.push(actor.userId as any);
        return item.save();
      }
    })
  );

  return { success: true };
};
