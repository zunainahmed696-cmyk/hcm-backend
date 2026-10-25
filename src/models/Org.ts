import mongoose, { Schema } from 'mongoose';

// Organization catalogs (M2) scoped per tenant. Admin manages; HR and Employees read.

const DepartmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Settings', required: true, index: true },
    name: { type: String, required: true, trim: true },
    shiftName: { type: String, default: 'Morning Shift', trim: true },
    shiftStart: { type: String, default: '09:00', trim: true },
    shiftEnd: { type: String, default: '17:00', trim: true },
    shiftGraceMinutes: { type: Number, default: 15, min: 0, max: 120 },
  },
  { timestamps: true }
);
DepartmentSchema.index({ tenantId: 1, name: 1 }, { unique: true });

const DesignationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Settings', required: true, index: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);
DesignationSchema.index({ tenantId: 1, name: 1 }, { unique: true });

const LeaveTypeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Settings', required: true, index: true },
    name: { type: String, required: true, trim: true },
    annualQuota: { type: Number, default: 0, min: 0 }, // days per year
    unlimited: { type: Boolean, default: false }, // e.g. unpaid leave
    isPaid: { type: Boolean, default: true },
  },
  { timestamps: true }
);
LeaveTypeSchema.index({ tenantId: 1, name: 1 }, { unique: true });

const HolidaySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Settings', required: true, index: true },
    name: { type: String, required: true, trim: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // YYYY-MM-DD
  },
  { timestamps: true }
);
HolidaySchema.index({ tenantId: 1, date: 1 }, { unique: true });

export const Department = mongoose.model('Department', DepartmentSchema);
export const Designation = mongoose.model('Designation', DesignationSchema);
export const LeaveType = mongoose.model('LeaveType', LeaveTypeSchema);
export const Holiday = mongoose.model('Holiday', HolidaySchema);
