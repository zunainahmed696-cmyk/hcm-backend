import Notification, { INotificationDocument } from '../models/Notification';
import { JWTPayload } from '../types';

export const getMyInbox = async (actor: JWTPayload) => {
  // Check if any notifications exist; if none, seed default welcoming company announcements
  const count = await Notification.countDocuments();
  if (count === 0) {
    await Notification.create([
      {
        type: 'announcement',
        title: 'Welcome to HCM Lite Enterprise Portal',
        message: 'Welcome to the modern workforce operations portal. Review your attendance, track office hours, submit leave requests, and explore your Employee 360 profile.',
        category: 'general',
        priority: 'high',
        senderName: 'Executive HR',
      },
      {
        type: 'announcement',
        title: 'Attendance & Grace Period Policy Reminder',
        message: 'Standard office hours begin at 09:00 AM with a 15-minute grace period. Check-ins after 09:15 AM are automatically marked as Late. Workdays under 5 hours are recorded as half-days.',
        category: 'attendance',
        priority: 'normal',
        senderName: 'HR Operations',
      },
      {
        type: 'notification',
        title: 'Employee Profile Setup Ready',
        message: 'Your corporate profile has been provisioned. You can verify your compensation breakdown, update your contact phone, and manage your residential address anytime.',
        category: 'system',
        priority: 'normal',
        recipientUserId: actor.userId as any,
        senderName: 'System Administration',
      },
    ]);
  }

  const items = await Notification.find({
    $or: [
      { recipientUserId: null }, // Company-wide announcement
      { recipientUserId: actor.userId }, // Direct notification
    ],
  }).sort({ createdAt: -1 });

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

export const markAsRead = async (actor: JWTPayload, id: string) => {
  const item = await Notification.findById(id);
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
    $or: [{ recipientUserId: null }, { recipientUserId: actor.userId }],
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
