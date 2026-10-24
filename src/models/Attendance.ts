import mongoose, { Schema, Document } from 'mongoose';

export type AttendanceStatus = 'present' | 'late' | 'half-day' | 'absent';
export type CorrectionStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface IAttendanceDocument extends Document {
  employeeId: string;
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  checkIn: Date;
  checkOut?: Date;
  status: AttendanceStatus;
  workHours: number;
  isLate: boolean;
  lateMinutes: number;
  checkInLocation?: {
    lat?: number;
    lng?: number;
    address?: string;
  };
  checkInPhoto?: string;
  checkOutLocation?: {
    lat?: number;
    lng?: number;
    address?: string;
  };
  checkOutPhoto?: string;
  correctionRequest?: {
    status: CorrectionStatus;
    requestedCheckIn?: Date;
    requestedCheckOut?: Date;
    reason?: string;
    requestedAt?: Date;
    reviewedBy?: mongoose.Types.ObjectId;
    reviewedAt?: Date;
    adminNotes?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSchema = new Schema<IAttendanceDocument>(
  {
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
    date: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    checkIn: {
      type: Date,
      required: true,
    },
    checkOut: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['present', 'late', 'half-day', 'absent'],
      default: 'present',
    },
    workHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    isLate: {
      type: Boolean,
      default: false,
    },
    lateMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    checkInLocation: {
      lat: Number,
      lng: Number,
      address: String,
    },
    checkInPhoto: {
      type: String,
    },
    checkOutLocation: {
      lat: Number,
      lng: Number,
      address: String,
    },
    checkOutPhoto: {
      type: String,
    },
    correctionRequest: {
      status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none',
      },
      requestedCheckIn: Date,
      requestedCheckOut: Date,
      reason: String,
      requestedAt: Date,
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
      reviewedAt: Date,
      adminNotes: String,
    },
  },
  {
    timestamps: true,
  }
);

// Enforce single check-in per employee per calendar day (Brief rule #09 -> 409 Conflict)
AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ date: 1, status: 1 });

export const Attendance = mongoose.model<IAttendanceDocument>('Attendance', AttendanceSchema);
export default Attendance;
