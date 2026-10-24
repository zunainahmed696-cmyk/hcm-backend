import mongoose, { Schema, Document } from 'mongoose';

export interface IPayslipDocument extends Document {
  employeeId: string;
  userId: mongoose.Types.ObjectId;
  month: string; // YYYY-MM
  basicSalary: number;
  grossSalary: number;
  hra: number;
  medical: number;
  workingDays: number;
  presentDays: number;
  lateCount: number;
  unpaidLeaveDays: number;
  halfDays: number;
  deductions: number;
  taxDeduction: number;
  netSalary: number;
  status: 'draft' | 'locked';
  paymentDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PayslipSchema = new Schema<IPayslipDocument>(
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
    month: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}$/,
      index: true,
    },
    basicSalary: { type: Number, required: true },
    grossSalary: { type: Number, required: true },
    hra: { type: Number, default: 0 },
    medical: { type: Number, default: 0 },
    workingDays: { type: Number, default: 22 },
    presentDays: { type: Number, default: 22 },
    lateCount: { type: Number, default: 0 },
    unpaidLeaveDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    taxDeduction: { type: Number, default: 0 },
    netSalary: { type: Number, required: true },
    status: {
      type: String,
      enum: ['draft', 'locked'],
      default: 'locked',
      index: true,
    },
    paymentDate: { type: String },
  },
  {
    timestamps: true,
  }
);

PayslipSchema.index({ employeeId: 1, month: 1 }, { unique: true });

export const Payslip = mongoose.model<IPayslipDocument>('Payslip', PayslipSchema);
export default Payslip;
