import mongoose, { Schema, Document } from 'mongoose';

export type LeaveType = 'Annual' | 'Sick' | 'Casual' | 'Unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ILeaveDocument extends Document {
  tenantId: mongoose.Types.ObjectId;
  employeeId: string;
  userId: mongoose.Types.ObjectId;
  leaveType: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  daysCount: number;
  reason: string;
  status: LeaveStatus;
  appliedAt: Date;
  actionBy?: mongoose.Types.ObjectId;
  actionAt?: Date;
  actionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveSchema = new Schema<ILeaveDocument>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Settings',
      required: true,
      index: true,
    },
    employeeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    leaveType: {
      type: String,
      enum: ['Annual', 'Sick', 'Casual', 'Unpaid'],
      required: true,
      index: true,
    },
    startDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    endDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    daysCount: {
      type: Number,
      required: true,
      min: 0.5,
    },
    reason: {
      type: String,
      required: [true, 'Leave reason is required'],
      trim: true,
      maxlength: [300, 'Reason cannot exceed 300 characters'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    actionBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    actionAt: {
      type: Date,
    },
    actionNotes: {
      type: String,
      trim: true,
      maxlength: [300, 'Action notes cannot exceed 300 characters'],
    },
  },
  {
    timestamps: true,
  }
);

LeaveSchema.index({ tenantId: 1, employeeId: 1, status: 1 });
LeaveSchema.index({ tenantId: 1, startDate: 1, endDate: 1 });

export const Leave = mongoose.model<ILeaveDocument>('Leave', LeaveSchema);
export default Leave;
