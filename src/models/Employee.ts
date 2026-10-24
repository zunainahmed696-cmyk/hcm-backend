import mongoose, { Schema, Document } from 'mongoose';

export interface IEmployeeDocument extends Document {
  employeeId: string; // Unique corporate code, e.g., EMP-001
  userId: mongoose.Types.ObjectId;
  name: string;
  fatherName: string;
  email: string;
  phone: string;
  address?: string;
  department: string;
  designation: string;
  role: 'admin' | 'hr' | 'employee';
  dateOfJoining: string; // ISO date YYYY-MM-DD
  basicSalary: number;
  grossSalary: number; // Virtual: 1.5 * basicSalary
  allowances: {
    hra: number;
    medical: number;
    total: number;
  };
  status: 'active' | 'probation' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSchema = new Schema<IEmployeeDocument>(
  {
    employeeId: {
      type: String,
      required: [true, 'Unique Employee ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Employee Name is required'],
      trim: true,
      maxlength: [80, 'Name cannot exceed 80 characters'],
    },
    fatherName: {
      type: String,
      required: [true, "Father's Name is required"],
      trim: true,
      maxlength: [80, "Father's name cannot exceed 80 characters"],
    },
    email: {
      type: String,
      required: [true, 'Corporate Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: ['admin', 'hr', 'employee'],
      default: 'employee',
      required: true,
    },
    dateOfJoining: {
      type: String,
      required: [true, 'Date of Joining is required'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date of Joining must be YYYY-MM-DD format'],
    },
    basicSalary: {
      type: Number,
      required: [true, 'Basic Salary is required'],
      min: [1, 'Basic salary must be greater than 0'],
    },
    status: {
      type: String,
      enum: ['active', 'probation', 'inactive'],
      default: 'active',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: Gross Salary = 1.5 * Basic Salary (40% HRA, 10% Medical allowance as per Hackathon M6 formula)
EmployeeSchema.virtual('grossSalary').get(function (this: IEmployeeDocument) {
  return Math.round(this.basicSalary * 1.5);
});

// Virtual: Allowances Breakdown
EmployeeSchema.virtual('allowances').get(function (this: IEmployeeDocument) {
  const hra = Math.round(this.basicSalary * 0.4);
  const medical = Math.round(this.basicSalary * 0.1);
  return {
    hra,
    medical,
    total: hra + medical,
  };
});

export const Employee = mongoose.model<IEmployeeDocument>('Employee', EmployeeSchema);
export default Employee;
