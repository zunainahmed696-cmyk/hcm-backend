import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType = 'announcement' | 'notification';
export type NotificationPriority = 'normal' | 'high' | 'urgent';

export interface INotificationDocument extends Document {
  type: NotificationType;
  title: string;
  message: string;
  category: 'system' | 'leave' | 'attendance' | 'payroll' | 'general';
  priority: NotificationPriority;
  recipientUserId?: mongoose.Types.ObjectId; // null = company-wide announcement
  senderName: string;
  readBy: mongoose.Types.ObjectId[];
  link?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotificationDocument>(
  {
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

NotificationSchema.index({ type: 1, createdAt: -1 });

export const Notification = mongoose.model<INotificationDocument>('Notification', NotificationSchema);
export default Notification;
