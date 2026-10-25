import Payslip from '../models/Payslip';
import Employee from '../models/Employee';
import Attendance from '../models/Attendance';
import Leave from '../models/Leave';
import { Notification } from '../models/Notification';
import { recordAudit } from './audit.service';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';

/**
 * Tax Slab Calculation per HCM Lite Brief Section 3:
 * Annual Gross = Monthly Gross * 12
 * - 0 to 600k: 0%
 * - 600,001 to 1.2M: 5% of excess over 600k
 * - 1,200,001 to 2.4M: 30,000 + 15% of excess over 1.2M
 * - 2,400,001 to 3.6M: 210,000 + 25% of excess over 2.4M
 * - Above 3.6M: 510,000 + 35% of excess over 3.6M
 */
export const calculateMonthlyTax = (monthlyGross: number): number => {
  const annualGross = monthlyGross * 12;
  let annualTax = 0;

  if (annualGross <= 600000) {
    annualTax = 0;
  } else if (annualGross <= 1200000) {
    annualTax = (annualGross - 600000) * 0.05;
  } else if (annualGross <= 2400000) {
    annualTax = 30000 + (annualGross - 1200000) * 0.15;
  } else if (annualGross <= 3600000) {
    annualTax = 210000 + (annualGross - 2400000) * 0.25;
  } else {
    annualTax = 510000 + (annualGross - 3600000) * 0.35;
  }

  return Math.round(annualTax / 12);
};

export interface EmployeePayrollItem {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  designation: string;
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
}

/**
 * Calculate Monthly Payroll Draft for all active employees in the tenant
 */
export const calculatePayrollRun = async (
  monthStr: string,
  actor: JWTPayload
): Promise<{
  month: string;
  totalGross: number;
  totalNet: number;
  totalTax: number;
  totalDeductions: number;
  employeeCount: number;
  status: 'draft' | 'locked';
  items: EmployeePayrollItem[];
}> => {
  const month = monthStr || new Date().toISOString().slice(0, 7);

  // Check if this month is already locked in DB for this tenant
  const existingLocked = await Payslip.find({
    tenantId: actor.tenantId,
    month,
    status: 'locked',
  }).lean();
  const isLocked = existingLocked.length > 0;

  const employees = await Employee.find({
    tenantId: actor.tenantId,
    status: { $ne: 'inactive' },
    role: { $ne: 'admin' },
  }).lean();
  const workingDays = 22; // Standard monthly working days

  const items: EmployeePayrollItem[] = [];

  for (const emp of employees) {
    // If locked records exist, use the saved snapshot
    const saved = existingLocked.find((p) => p.employeeId === emp.employeeId);
    if (saved) {
      items.push({
        employeeId: emp.employeeId,
        name: emp.name,
        email: emp.email,
        department: emp.department,
        designation: emp.designation,
        basicSalary: saved.basicSalary,
        grossSalary: saved.grossSalary,
        hra: saved.hra,
        medical: saved.medical,
        workingDays: saved.workingDays,
        presentDays: saved.presentDays,
        lateCount: saved.lateCount,
        unpaidLeaveDays: saved.unpaidLeaveDays,
        halfDays: saved.halfDays,
        deductions: saved.deductions,
        taxDeduction: saved.taxDeduction,
        netSalary: saved.netSalary,
        status: saved.status,
      });
      continue;
    }

    // Otherwise compute live draft
    const basic = emp.basicSalary || 100000;
    const hra = Math.round(basic * 0.4);
    const medical = Math.round(basic * 0.1);
    const gross = Math.round(basic * 1.5);

    // Attendance records for the month
    const attendances = await Attendance.find({
      tenantId: actor.tenantId,
      employeeId: emp.employeeId,
      date: new RegExp(`^${month}`),
    }).lean();

    const presentDays = attendances.filter((a) => a.status === 'present' || a.status === 'late').length;
    const lateCount = attendances.filter((a) => a.isLate || a.status === 'late').length;
    const halfDays = attendances.filter((a) => a.status === 'half-day').length;

    // Unpaid leaves
    const unpaidLeaves = await Leave.find({
      tenantId: actor.tenantId,
      employeeId: emp.employeeId,
      status: 'approved',
      leaveType: 'Unpaid',
      startDate: new RegExp(`^${month}`),
    }).lean();
    const unpaidDays = unpaidLeaves.reduce((acc, l) => acc + (l.daysCount || 0), 0);

    // Daily gross rate
    const dailyRate = gross / workingDays;

    // Days absent (workingDays minus attended and minus approved paid leaves)
    const absentDays = Math.max(0, workingDays - presentDays - halfDays);

    // Deductions: (absentDays + unpaidDays + 0.5 * halfDays) * dailyRate
    const effectiveDeductionDays = Math.min(workingDays, absentDays * 0.5 + unpaidDays + halfDays * 0.5);
    const deductions = Math.round(effectiveDeductionDays * dailyRate);

    // Tax calculation on gross
    const taxDeduction = calculateMonthlyTax(gross);

    // Net Salary
    const netSalary = Math.max(0, gross - deductions - taxDeduction);

    items.push({
      employeeId: emp.employeeId,
      name: emp.name,
      email: emp.email,
      department: emp.department,
      designation: emp.designation,
      basicSalary: basic,
      grossSalary: gross,
      hra,
      medical,
      workingDays,
      presentDays,
      lateCount,
      unpaidLeaveDays: unpaidDays,
      halfDays,
      deductions,
      taxDeduction,
      netSalary,
      status: 'draft',
    });
  }

  const totalGross = items.reduce((acc, i) => acc + i.grossSalary, 0);
  const totalNet = items.reduce((acc, i) => acc + i.netSalary, 0);
  const totalTax = items.reduce((acc, i) => acc + i.taxDeduction, 0);
  const totalDeductions = items.reduce((acc, i) => acc + i.deductions, 0);

  return {
    month,
    totalGross,
    totalNet,
    totalTax,
    totalDeductions,
    employeeCount: items.length,
    status: isLocked ? 'locked' : 'draft',
    items,
  };
};

/**
 * Finalize & Lock Monthly Payroll for the tenant (Admin only per Brief Section 2 & #16)
 */
export const finalizePayrollRun = async (actor: JWTPayload, monthStr: string) => {
  if (actor.role !== 'admin') {
    throw new AppError('Only Administrator / Owner has the authority to finalize and lock payroll runs.', 403);
  }

  const month = monthStr || new Date().toISOString().slice(0, 7);

  // Check if already finalized for this tenant
  const existingLocked = await Payslip.findOne({
    tenantId: actor.tenantId,
    month,
    status: 'locked',
  });
  if (existingLocked) {
    throw new AppError(`Payroll for ${month} has already been finalized and locked. Edits are prohibited.`, 400);
  }

  const run = await calculatePayrollRun(month, actor);
  const employees = await Employee.find({
    tenantId: actor.tenantId,
    status: { $ne: 'inactive' },
    role: { $ne: 'admin' },
  }).lean();
  const empMap = new Map(employees.map((e) => [e.employeeId, e]));

  const createdPayslips = [];

  for (const item of run.items) {
    const emp = empMap.get(item.employeeId);
    if (!emp) continue;

    // Upsert payslip record scoped to tenant
    const payslip = await Payslip.findOneAndUpdate(
      { tenantId: actor.tenantId, employeeId: item.employeeId, month },
      {
        tenantId: actor.tenantId,
        employeeId: item.employeeId,
        userId: emp.userId,
        month,
        basicSalary: item.basicSalary,
        grossSalary: item.grossSalary,
        hra: item.hra,
        medical: item.medical,
        workingDays: item.workingDays,
        presentDays: item.presentDays,
        lateCount: item.lateCount,
        unpaidLeaveDays: item.unpaidLeaveDays,
        halfDays: item.halfDays,
        deductions: item.deductions,
        taxDeduction: item.taxDeduction,
        netSalary: item.netSalary,
        status: 'locked',
        paymentDate: new Date().toISOString().slice(0, 10),
      },
      { upsert: true, new: true }
    );
    createdPayslips.push(payslip);

    // Notify employee that their payslip is available
    if (emp.userId) {
      try {
        await Notification.create({
          tenantId: actor.tenantId,
          type: 'notification',
          title: `Payslip Available: ${month}`,
          message: `Your salary payslip for ${month} has been finalized by Admin. Net pay: Rs. ${item.netSalary.toLocaleString()}. Download your slip under My Payslips.`,
          category: 'payroll',
          priority: 'normal',
          recipientUserId: emp.userId,
          senderName: 'Payroll Officer',
          link: '/payslips',
        });
      } catch (err) {
        console.error('[Notification Error - Payslip]', err);
      }
    }
  }

  await recordAudit({
    actor,
    action: 'FINALIZE',
    entity: 'Payroll',
    entityId: month,
    after: {
      month,
      employeeCount: run.employeeCount,
      totalGross: run.totalGross,
      totalNet: run.totalNet,
      totalTax: run.totalTax,
    },
  });

  return {
    month,
    message: `Payroll for ${month} successfully finalized and locked. ${createdPayslips.length} employee payslips published.`,
    summary: {
      employeeCount: run.employeeCount,
      totalGross: run.totalGross,
      totalNet: run.totalNet,
      totalTax: run.totalTax,
    },
  };
};

/**
 * Get own payslips for the authenticated employee
 */
export const getMyPayslips = async (actor: JWTPayload) => {
  const employee = await Employee.findOne({ userId: actor.userId, tenantId: actor.tenantId });
  if (!employee) return [];

  const payslips = await Payslip.find({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    status: 'locked',
  })
    .sort({ month: -1 })
    .lean();

  return payslips.map((p) => ({
    ...p,
    employeeName: employee.name,
    department: employee.department,
    designation: employee.designation,
  }));
};
