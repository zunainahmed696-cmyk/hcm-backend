import Leave, { LeaveType } from '../models/Leave';
import { LeaveType as LeaveTypeModel, Holiday } from '../models/Org';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import Employee from '../models/Employee';
import { getActorEmployee } from './attendance.service';
import { recordAudit } from './audit.service';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';

/** Calculate working days strictly skipping weekend days and registered public holidays for the tenant (Brief #14) */
export const calculateWorkingDays = async (
  startDateStr: string,
  endDateStr: string,
  tenantId?: string
): Promise<{ workingDays: number; holidaysEncountered: string[]; weekendsEncountered: number }> => {
  const settings = tenantId ? await Settings.findById(tenantId) : await Settings.findOne();
  const weekendDays = new Set(settings?.weekend || [0, 6]);

  const holidayFilter: Record<string, any> = {
    date: { $gte: startDateStr, $lte: endDateStr },
  };
  if (tenantId) holidayFilter.tenantId = tenantId;

  const holidays = await Holiday.find(holidayFilter);
  const holidayDateSet = new Set(holidays.map((h) => h.date));

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  let workingDays = 0;
  let weekendsEncountered = 0;
  const holidaysEncountered: string[] = [];

  const curr = new Date(start);
  while (curr <= end) {
    const dayOfWeek = curr.getDay();
    const currStr = curr.toISOString().slice(0, 10);

    if (weekendDays.has(dayOfWeek)) {
      weekendsEncountered++;
    } else if (holidayDateSet.has(currStr)) {
      holidaysEncountered.push(currStr);
    } else {
      workingDays++;
    }

    curr.setDate(curr.getDate() + 1);
  }

  return { workingDays, holidaysEncountered, weekendsEncountered };
};

/** Get remaining leave quota balances for an employee within their tenant */
export const getLeaveBalances = async (employeeId: string, tenantId?: string) => {
  const yearPrefix = new Date().getFullYear().toString();

  // Load configured leave types (Annual: 14, Sick: 8, Casual: 10, Unpaid)
  const typeFilter: Record<string, any> = tenantId ? { tenantId } : {};
  const configuredTypes = await LeaveTypeModel.find(typeFilter);
  const quotas: Record<string, { quota: number; unlimited: boolean; isPaid: boolean }> = {
    Annual: { quota: 14, unlimited: false, isPaid: true },
    Sick: { quota: 8, unlimited: false, isPaid: true },
    Casual: { quota: 10, unlimited: false, isPaid: true },
    Unpaid: { quota: 0, unlimited: true, isPaid: false },
  };

  configuredTypes.forEach((t) => {
    quotas[t.name] = {
      quota: t.annualQuota,
      unlimited: t.unlimited,
      isPaid: t.isPaid,
    };
  });

  // Aggregate used and pending leaves this year
  const leaveFilter: Record<string, any> = {
    employeeId,
    startDate: { $regex: `^${yearPrefix}` },
    status: { $in: ['approved', 'pending'] },
  };
  if (tenantId) leaveFilter.tenantId = tenantId;

  const activeLeaves = await Leave.find(leaveFilter);

  const usedMap: Record<string, number> = {};
  const pendingMap: Record<string, number> = {};

  activeLeaves.forEach((l) => {
    if (l.status === 'approved') {
      usedMap[l.leaveType] = (usedMap[l.leaveType] || 0) + l.daysCount;
    } else if (l.status === 'pending') {
      pendingMap[l.leaveType] = (pendingMap[l.leaveType] || 0) + l.daysCount;
    }
  });

  const balances = Object.keys(quotas).map((type) => {
    const info = quotas[type];
    const used = usedMap[type] || 0;
    const pending = pendingMap[type] || 0;
    const remaining = info.unlimited ? 999 : Math.max(0, info.quota - used - pending);

    return {
      type: type as LeaveType,
      quota: info.unlimited ? 'Unlimited' : info.quota,
      used,
      pending,
      remaining: info.unlimited ? 'Unlimited' : remaining,
      numericRemaining: info.unlimited ? 999 : remaining,
      unlimited: info.unlimited,
      isPaid: info.isPaid,
    };
  });

  return balances;
};

/** Apply for leave with overlap check, working day calculation, and quota verification (Brief #14) */
export const applyLeave = async (
  actor: JWTPayload,
  input: {
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
  }
) => {
  if (!input.leaveType) throw new AppError('Leave type is required.', 422);
  if (!input.startDate || !input.endDate) throw new AppError('Start date and End date are required.', 422);
  if (input.endDate < input.startDate) {
    throw new AppError('End date cannot precede start date.', 422);
  }
  if (!input.reason?.trim()) throw new AppError('Reason is required.', 422);

  const employee = await getActorEmployee(actor);

  // 1. Calculate working days
  const { workingDays, holidaysEncountered, weekendsEncountered } = await calculateWorkingDays(
    input.startDate,
    input.endDate,
    actor.tenantId
  );

  if (workingDays <= 0) {
    throw new AppError(
      'Selected date range only contains weekend days or public holidays. No working days deducted.',
      422
    );
  }

  // 2. Overlap check (Brief #14 -> 422 Unprocessable Entity)
  const overlapping = await Leave.findOne({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: input.endDate },
    endDate: { $gte: input.startDate },
  });

  if (overlapping) {
    throw new AppError(
      `You already have an active leave request (${overlapping.leaveType}, ${overlapping.startDate} to ${overlapping.endDate}) overlapping these dates.`,
      422
    );
  }

  // 3. Quota check (Brief #14 -> 422 with available balance)
  const balances = await getLeaveBalances(employee.employeeId, actor.tenantId);
  const targetBal = balances.find((b) => b.type === input.leaveType);
  if (targetBal && !targetBal.unlimited) {
    if (targetBal.numericRemaining < workingDays) {
      throw new AppError(
        `Insufficient leave balance for ${input.leaveType}. You requested ${workingDays} working day(s), but only have ${targetBal.remaining} day(s) available.`,
        422
      );
    }
  }

  // 4. Create Leave record
  const leave = await Leave.create({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    userId: actor.userId,
    leaveType: input.leaveType,
    startDate: input.startDate,
    endDate: input.endDate,
    daysCount: workingDays,
    reason: input.reason.trim(),
    status: 'pending',
  });

  await recordAudit({
    actor,
    action: 'CREATE',
    entity: 'Leave',
    entityId: leave._id.toString(),
    after: {
      employeeId: leave.employeeId,
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      daysCount: leave.daysCount,
      reason: leave.reason,
    },
  });

  // Notify Owner (Admin) and HR officers in the same tenant of new leave request
  try {
    const supervisors = await User.find({
      tenantId: actor.tenantId,
      role: { $in: ['admin', 'hr'] },
      isActive: true,
    });
    await Promise.all(
      supervisors.map((s) =>
        Notification.create({
          tenantId: actor.tenantId,
          type: 'notification',
          title: `New Leave Request: ${employee.name}`,
          message: `${employee.name} (${employee.employeeId}, ${employee.department}) requested ${workingDays} working day(s) of ${input.leaveType} leave from ${input.startDate} to ${input.endDate}. Reason: "${input.reason.trim()}".`,
          category: 'leave',
          priority: 'high',
          recipientUserId: s._id,
          senderName: employee.name,
          link: '/leave',
        })
      )
    );
  } catch (err) {
    console.error('[Notification Error - Leave Request]:', err);
  }

  return {
    leave,
    summary: {
      workingDays,
      holidaysEncountered,
      weekendsEncountered,
    },
  };
};

/** List all pending leave requests across the tenant for HR / Admin review */
export const listPendingLeaves = async (actor: JWTPayload) => {
  const pending = await Leave.find({ tenantId: actor.tenantId, status: 'pending' })
    .sort({ createdAt: -1 })
    .lean();
  const employeeIds = [...new Set(pending.map((p) => p.employeeId))];
  const employees = await Employee.find({
    tenantId: actor.tenantId,
    employeeId: { $in: employeeIds },
  }).lean();
  const empMap = new Map(employees.map((e) => [e.employeeId, e]));

  return pending.map((p) => {
    const emp = empMap.get(p.employeeId);
    return {
      ...p,
      employeeName: emp?.name || p.employeeId,
      department: emp?.department || 'Operations',
      designation: emp?.designation || 'Specialist',
    };
  });
};

/** List all tenant leave requests for HR / Admin */
export const listAllLeaves = async (actor: JWTPayload) => {
  const leaves = await Leave.find({ tenantId: actor.tenantId }).sort({ createdAt: -1 }).lean();
  const employeeIds = [...new Set(leaves.map((l) => l.employeeId))];
  const employees = await Employee.find({
    tenantId: actor.tenantId,
    employeeId: { $in: employeeIds },
  }).lean();
  const empMap = new Map(employees.map((e) => [e.employeeId, e]));

  return leaves.map((l) => {
    const emp = empMap.get(l.employeeId);
    return {
      ...l,
      employeeName: emp?.name || l.employeeId,
      department: emp?.department || 'Operations',
      designation: emp?.designation || 'Specialist',
    };
  });
};

/** Approve or Reject an employee's leave request (HR or Admin) */
export const updateLeaveStatus = async (
  actor: JWTPayload,
  leaveId: string,
  status: 'approved' | 'rejected',
  notes?: string
) => {
  if (actor.role !== 'admin' && actor.role !== 'hr') {
    throw new AppError('Only HR officers and Administrators can review leave requests.', 403);
  }

  const leave = await Leave.findOne({ _id: leaveId, tenantId: actor.tenantId });
  if (!leave) throw new AppError('Leave request not found.', 404);
  if (leave.status !== 'pending') {
    throw new AppError(`Cannot review a leave that is already ${leave.status}.`, 400);
  }

  leave.status = status;
  leave.actionBy = actor.userId as any;
  leave.actionAt = new Date();
  if (notes) leave.actionNotes = notes.trim();

  await leave.save();

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'Leave',
    entityId: leave._id.toString(),
    after: {
      status,
      actionBy: actor.userId,
      actionNotes: notes,
    },
  });

  // Notify the employee directly of the HR decision
  try {
    const reviewer = await User.findById(actor.userId);
    const reviewerName = reviewer?.name || actor.email;
    await Notification.create({
      tenantId: actor.tenantId,
      type: 'notification',
      title: `Leave Request ${status === 'approved' ? 'Approved ✓' : 'Rejected ✗'}`,
      message: `Your ${leave.leaveType} leave request (${leave.startDate} to ${leave.endDate}, ${leave.daysCount} working days) has been ${status} by ${reviewerName}.${notes ? ` Decision note: "${notes.trim()}".` : ''}`,
      category: 'leave',
      priority: status === 'approved' ? 'normal' : 'high',
      recipientUserId: leave.userId,
      senderName: reviewerName,
      link: '/leave',
    });
  } catch (err) {
    console.error('[Notification Error - Leave Decision]:', err);
  }

  return leave;
};

/** Cancel a pending leave request */
export const cancelLeave = async (actor: JWTPayload, leaveId: string) => {
  const employee = await getActorEmployee(actor);
  const leave = await Leave.findOne({ _id: leaveId, tenantId: actor.tenantId });

  if (!leave) throw new AppError('Leave request not found.', 404);
  if (leave.employeeId !== employee.employeeId && actor.role === 'employee') {
    throw new AppError('You can only cancel your own leave requests.', 403);
  }
  if (leave.status !== 'pending') {
    throw new AppError(`Cannot cancel a leave that is already ${leave.status}.`, 400);
  }

  leave.status = 'cancelled';
  await leave.save();

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'Leave',
    entityId: leave._id.toString(),
    after: { status: 'cancelled' },
  });

  return leave;
};

/** List all leaves for the logged in employee */
export const getMyLeaves = async (actor: JWTPayload) => {
  // Owners (role: 'admin') do not have personal employee leave accounts
  if (actor.role === 'admin') {
    return { leaves: [], balances: [] };
  }

  const employee = await getActorEmployee(actor);
  const [leaves, balances] = await Promise.all([
    Leave.find({ tenantId: actor.tenantId, employeeId: employee.employeeId }).sort({ createdAt: -1 }),
    getLeaveBalances(employee.employeeId, actor.tenantId),
  ]);

  return { leaves, balances };
};

/** Smart Leave NLP / Regex Parser (Brief #15) */
export const smartParseLeave = (plainText: string) => {
  const text = plainText.trim().toLowerCase();
  const now = new Date();

  // Inferred Type
  let leaveType: LeaveType = 'Casual';
  if (text.includes('sick') || text.includes('fever') || text.includes('doctor') || text.includes('hospital') || text.includes('medical') || text.includes('ill')) {
    leaveType = 'Sick';
  } else if (text.includes('annual') || text.includes('vacation') || text.includes('trip') || text.includes('holiday') || text.includes('tour')) {
    leaveType = 'Annual';
  } else if (text.includes('unpaid') || text.includes('loss of pay') || text.includes('lop')) {
    leaveType = 'Unpaid';
  } else if (text.includes('wedding') || text.includes('personal') || text.includes('urgent') || text.includes('family') || text.includes('casual')) {
    leaveType = 'Casual';
  }

  // Helper date adder
  const addDays = (d: Date, n: number) => {
    const res = new Date(d);
    res.setDate(res.getDate() + n);
    return res.toISOString().slice(0, 10);
  };

  // Helper next weekday
  const getNextWeekday = (dayName: string) => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const target = days.indexOf(dayName);
    if (target === -1) return addDays(now, 1);
    const curr = now.getDay();
    let diff = target - curr;
    if (diff <= 0) diff += 7;
    return addDays(now, diff);
  };

  let startDate = addDays(now, 1);
  let endDate = addDays(now, 1);

  if (text.includes('today')) {
    startDate = addDays(now, 0);
    endDate = addDays(now, 0);
  } else if (text.includes('tomorrow')) {
    startDate = addDays(now, 1);
    endDate = addDays(now, 1);
  } else if (text.includes('day after tomorrow')) {
    startDate = addDays(now, 2);
    endDate = addDays(now, 2);
  } else if (text.includes('next monday')) {
    startDate = getNextWeekday('monday');
    endDate = text.includes('tuesday') ? addDays(new Date(startDate), 1) : startDate;
  } else if (text.includes('next friday')) {
    startDate = getNextWeekday('friday');
    endDate = startDate;
  }

  // Regex ISO dates e.g. 2026-11-05
  const isoDates = text.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoDates && isoDates.length >= 2) {
    startDate = isoDates[0];
    endDate = isoDates[1];
  } else if (isoDates && isoDates.length === 1) {
    startDate = isoDates[0];
    endDate = isoDates[0];
  }

  return {
    leaveType,
    startDate,
    endDate,
    reason: plainText.trim(),
    confidence: 'high',
  };
};
