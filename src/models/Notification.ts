import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType = 'announcement' | 'notification';
export type NotificationPriority = 'normal' | 'high' | 'urgent';
export type AnnouncementScope = 'everyone' | 'department' | 'employee';

export interface INotificationDocument extends Document {
  tenantId?: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  category: 'system' | 'leave' | 'attendance' | 'payroll' | 'general';
  priority: NotificationPriority;
  targetScope: AnnouncementScope;
  targetDepartment?: string | null;
  targetEmployeeId?: string | null;
  recipientUserId?: mongoose.Types.ObjectId; // null = company-wide announcement
  senderName: string;
  readBy: mongoose.Types.ObjectId[];
  link?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotificationDocument>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Settings',
      index: true,
    },
    type: {
      type: String,
      enum: ['announcement', 'notification'],
      default: 'announcement',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['system', 'leave', 'attendance', 'payroll', 'general'],
      default: 'general',
    },
    priority: {
      type: String,
      enum: ['normal', 'high', 'urgent'],
      default: 'normal',
    },
    targetScope: {
      type: String,
      enum: ['everyone', 'department', 'employee'],
      default: 'everyone',
      index: true,
    },
    targetDepartment: {
      type: String,
      default: null,
      trim: true,
    },
    targetEmployeeId: {
      type: String,
      default: null,
      trim: true,
    },
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    senderName: {
      type: String,
      default: 'Management',
      trim: true,
    },
    readBy: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    link: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

NotificationSchema.index({ tenantId: 1, type: 1, createdAt: -1 });

export const Notification = mongoose.model<INotificationDocument>('Notification', NotificationSchema);
export default Notification;
