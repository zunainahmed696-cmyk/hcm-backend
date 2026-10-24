import mongoose, { Schema } from 'mongoose';

// Organization catalogs (M2). Admin manages; HR and Employees read.

const DepartmentSchema = new Schema({ name: { type: String, required: true, trim: true, unique: true } }, { timestamps: true });

const DesignationSchema = new Schema({ name: { type: String, required: true, trim: true, unique: true } }, { timestamps: true });

const LeaveTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    annualQuota: { type: Number, default: 0, min: 0 }, // days per year
    unlimited: { type: Boolean, default: false }, // e.g. unpaid leave
    isPaid: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const HolidaySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // YYYY-MM-DD
  },
  { timestamps: true }
);

export const Department = mongoose.model('Department', DepartmentSchema);
export const Designation = mongoose.model('Designation', DesignationSchema);
export const LeaveType = mongoose.model('LeaveType', LeaveTypeSchema);
export const Holiday = mongoose.model('Holiday', HolidaySchema);
