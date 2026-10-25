import Attendance from '../models/Attendance';
import Leave from '../models/Leave';
import Employee from '../models/Employee';
import Payslip from '../models/Payslip';
import { Department } from '../models/Org';
import { User } from '../models/User';
import { Settings } from '../models/Settings';
import { getActorEmployee } from './attendance.service';
import { getLeaveBalances } from './leave.service';
import { getMyInbox } from './notification.service';
import { JWTPayload } from '../types';

export const getEmployeeDashboardData = async (actor: JWTPayload) => {
  const employee = await getActorEmployee(actor);
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
  const todayStr = now.toISOString().slice(0, 10);

  const [attendancesThisMonth, todayAttendance, balances, inbox, settings, latestPayslip] =
    await Promise.all([
      Attendance.find({
        tenantId: actor.tenantId,
        employeeId: employee.employeeId,
        date: new RegExp(`^${currentMonth}`),
      }),
      Attendance.findOne({
        tenantId: actor.tenantId,
        employeeId: employee.employeeId,
        date: todayStr,
      }),
      getLeaveBalances(employee.employeeId, actor.tenantId),
      getMyInbox(actor),
      Settings.findById(actor.tenantId),
      Payslip.findOne({ tenantId: actor.tenantId, employeeId: employee.employeeId }).sort({ month: -1 }),
    ]);

  const presentCount = attendancesThisMonth.filter((a) => a.status === 'present' || a.status === 'late').length;
  const lateCount = attendancesThisMonth.filter((a) => a.isLate || a.status === 'late').length;
  const halfDayCount = attendancesThisMonth.filter((a) => a.status === 'half-day').length;
  let totalHours = Math.round(attendancesThisMonth.reduce((acc, a) => acc + (a.workHours || 0), 0) * 10) / 10;

  // If checked in today and currently active, calculate live ongoing shift duration
  let liveActiveHours = 0;
  if (todayAttendance?.checkIn && !todayAttendance?.checkOut) {
    const elapsedMs = now.getTime() - new Date(todayAttendance.checkIn).getTime();
    liveActiveHours = Math.max(0, Math.round((elapsedMs / (1000 * 60 * 60)) * 10) / 10);
    totalHours = Math.round((totalHours + liveActiveHours) * 10) / 10;
  }

  // Total working days in month remaining across standard quotas
  const totalLeaveDaysRemaining = balances
    .filter((b) => !b.unlimited)
    .reduce((acc, b) => acc + (typeof b.remaining === 'number' ? b.remaining : 0), 0);

  // Computed estimated salary preview
  const basicSalary = employee.basicSalary || 100000;
  const grossSalary = employee.grossSalary || Math.round(basicSalary * 1.5);

  return {
    employee: {
      id: employee._id.toString(),
      employeeId: employee.employeeId,
      name: employee.name,
      fatherName: employee.fatherName,
      department: employee.department,
      designation: employee.designation,
      email: employee.email,
      phone: employee.phone,
      address: employee.address,
      dateOfJoining: employee.dateOfJoining,
      basicSalary,
      grossSalary,
      role: employee.role,
      shiftName: (employee as any).shiftName || 'Morning Shift',
      shiftStart: (employee as any).shiftStart || settings?.officeStart || '09:00',
      shiftEnd: (employee as any).shiftEnd || '17:00',
      shiftGraceMinutes: (employee as any).shiftGraceMinutes ?? settings?.graceMinutes ?? 15,
    },
    metrics: {
      currentMonth,
      todayStr,
      presentCount,
      lateCount,
      halfDayCount,
      totalHours,
      liveActiveHours,
      totalLeaveDaysRemaining,
    },
    today: {
      attendanceId: todayAttendance?._id?.toString() || null,
      checkedIn: !!todayAttendance,
      checkedOut: !!todayAttendance?.checkOut,
      checkInTime: todayAttendance?.checkIn,
      checkOutTime: todayAttendance?.checkOut,
      status: todayAttendance?.status || 'not_marked',
      workHours: todayAttendance?.workHours || liveActiveHours,
      isLate: todayAttendance?.isLate || false,
      lateMinutes: todayAttendance?.lateMinutes || 0,
      checkInPhoto: todayAttendance?.checkInPhoto || null,
      checkOutPhoto: todayAttendance?.checkOutPhoto || null,
      clockOutResetRequest: todayAttendance?.clockOutResetRequest || { status: 'none' },
    },
    leaveBalances: balances,
    announcements: inbox.announcements.slice(0, 5),
    notifications: inbox.notifications.slice(0, 5),
    unreadCount: inbox.unreadCount,
    settings: {
      companyName: settings?.companyName || 'HCM Workspace',
      officeStart: (employee as any).shiftStart || settings?.officeStart || '09:00',
      graceMinutes: (employee as any).shiftGraceMinutes ?? settings?.graceMinutes ?? 15,
      halfDayHours: settings?.halfDayHours ?? 5,
      weekend: settings?.weekend || [0, 6],
    },
    lastPayslip: latestPayslip
      ? {
          month: latestPayslip.month,
          grossSalary: latestPayslip.grossSalary,
          netSalary: latestPayslip.netSalary,
          status: latestPayslip.status,
        }
      : {
          month: currentMonth,
          grossSalary,
          netSalary: grossSalary, // preview
          status: 'estimated',
        },
  };
};

export const getAdminDashboardData = async (actor: JWTPayload) => {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7);
  const tenantId = actor.tenantId;

  const [
    catalogDepts,
    allEmployees,
    hrUsersCount,
    todayAttendances,
    approvedLeavesToday,
    pendingLeaveCount,
    pendingLeaves,
    pendingClockOutResets,
    payrollRecords,
  ] = await Promise.all([
    Department.find({ tenantId }).sort({ name: 1 }).lean(),
    Employee.find({ tenantId, status: { $ne: 'inactive' }, role: { $ne: 'admin' } })
      .select('employeeId name department designation role status')
      .lean(),
    User.countDocuments({ tenantId, role: 'hr', isActive: true }),
    Attendance.find({ tenantId, date: todayStr }).sort({ checkIn: -1 }).lean(),
    Leave.find({ tenantId, status: 'approved', startDate: { $lte: todayStr }, endDate: { $gte: todayStr } }).lean(),
    Leave.countDocuments({ tenantId, status: 'pending' }),
    Leave.find({ tenantId, status: 'pending' }).sort({ createdAt: -1 }).limit(10).lean(),
    Attendance.find({ tenantId, 'clockOutResetRequest.status': 'pending' })
      .sort({ 'clockOutResetRequest.requestedAt': -1 })
      .limit(10)
      .lean(),
    Payslip.find({ tenantId, month: currentMonth }).select('status').lean(),
  ]);

  const totalEmployees = allEmployees.length;
  const empMap = new Map(allEmployees.map((e) => [e.employeeId, e]));

  // Accurate department distribution including all catalog departments (even those with 0 staff)
  const departmentDistribution: Record<string, number> = {};
  catalogDepts.forEach((d: any) => {
    if (d.name) {
      departmentDistribution[d.name] = 0;
    }
  });
  allEmployees.forEach((emp) => {
    const dept = emp.department || 'Operations';
    departmentDistribution[dept] = (departmentDistribution[dept] || 0) + 1;
  });

  // Accurate HR count: unique employees with role === 'hr' or in Human Resources department, or provisioned HR users
  const hrEmployeesCount = allEmployees.filter(
    (e) => e.role === 'hr' || (e.department || '').toLowerCase() === 'human resources'
  ).length;
  const hrCount = Math.max(hrUsersCount, hrEmployeesCount);

  // Filter today's attendances to active employees in this tenant
  const validTodayAttendances = todayAttendances.filter((a) => empMap.has(a.employeeId));
  const presentToday = validTodayAttendances.filter((a) =>
    ['present', 'late', 'half-day'].includes(a.status)
  ).length;
  const lateToday = validTodayAttendances.filter((a) => a.isLate).length;
  const onTimeToday = Math.max(0, presentToday - lateToday);

  const distinctLeaveEmpIds = new Set(
    approvedLeavesToday.filter((l) => empMap.has(l.employeeId)).map((l) => l.employeeId)
  );
  const onLeaveToday = distinctLeaveEmpIds.size;
  const absentToday = Math.max(0, totalEmployees - presentToday - onLeaveToday);
  const attendanceRate = totalEmployees > 0 ? Math.min(100, Math.round((presentToday / totalEmployees) * 100)) : 0;

  // Payroll status for month
  const isPayrollLocked = payrollRecords.length > 0 && payrollRecords.every((p) => p.status === 'locked');
  const hasPayrollDraft = payrollRecords.length > 0;

  const enrichedRecentAttendances = validTodayAttendances.slice(0, 15).map((a) => {
    const emp = empMap.get(a.employeeId);
    return {
      ...a,
      employeeName: emp?.name || a.employeeId,
      department: emp?.department || '',
      designation: emp?.designation || '',
    };
  });

  const enrichedPendingLeaves = pendingLeaves.map((l) => {
    const emp = empMap.get(l.employeeId);
    return {
      ...l,
      employeeName: emp?.name || l.employeeId,
      department: emp?.department || '',
      designation: emp?.designation || '',
    };
  });

  const enrichedClockOutResets = pendingClockOutResets.map((a) => {
    const emp = empMap.get(a.employeeId);
    return {
      ...a,
      employeeName: emp?.name || a.employeeId,
      department: emp?.department || '',
      designation: emp?.designation || '',
      reason: a.clockOutResetRequest?.reason || 'Accidental clock-out — requesting shift reopen.',
    };
  });

  const attendanceSubtext =
    presentToday === 0
      ? 'No check-ins recorded yet today'
      : lateToday > 0
      ? `${lateToday} late arrival(s) today`
      : 'All present staff checked in on time';

  return {
    todayStr,
    currentMonth,
    cards: {
      attendance: {
        present: presentToday,
        total: totalEmployees,
        late: lateToday,
        onTime: onTimeToday,
        absent: absentToday,
        attendanceRate,
        displayValue: `${presentToday} / ${totalEmployees}`,
        subtext: attendanceSubtext,
      },
      totalHR: {
        count: hrCount,
        displayValue: `${hrCount}`,
        subtext: 'Active HR personnel in workspace',
      },
      onLeave: {
        count: onLeaveToday,
        pending: pendingLeaveCount,
        displayValue: `${onLeaveToday}`,
        subtext: `${pendingLeaveCount} pending review request(s)`,
      },
      payroll: {
        status: isPayrollLocked ? 'Locked' : hasPayrollDraft ? 'Draft Generated' : 'Pending Calculation',
        currentMonth,
      },
    },
    departmentDistribution,
    recentAttendances: enrichedRecentAttendances,
    pendingLeaves: enrichedPendingLeaves,
    pendingClockOutResets: enrichedClockOutResets,
  };
};

export const getHRDashboardData = async (actor: JWTPayload) => {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);
  const tenantId = actor.tenantId;

  const [
    catalogDepts,
    allEmployees,
    todayAttendances,
    approvedLeavesToday,
    actualPendingLeavesCount,
    pendingLeaves,
    pendingCorrectionsCount,
    pendingClockOutResets,
    monthlyAttendances,
  ] = await Promise.all([
    Department.find({ tenantId }).sort({ name: 1 }).lean(),
    Employee.find({ tenantId, status: { $ne: 'inactive' }, role: { $ne: 'admin' } }).lean(),
    Attendance.find({ tenantId, date: todayStr }).sort({ checkIn: -1 }).lean(),
    Leave.find({ tenantId, status: 'approved', startDate: { $lte: todayStr }, endDate: { $gte: todayStr } }).lean(),
    Leave.countDocuments({ tenantId, status: 'pending' }),
    Leave.find({ tenantId, status: 'pending' }).sort({ createdAt: -1 }).limit(10).lean(),
    Attendance.countDocuments({ tenantId, 'correctionRequest.status': 'pending' }),
    Attendance.find({ tenantId, 'clockOutResetRequest.status': 'pending' })
      .sort({ 'clockOutResetRequest.requestedAt': -1 })
      .limit(10)
      .lean(),
    Attendance.find({ tenantId, date: new RegExp(`^${monthStr}`), isLate: true }).lean(),
  ]);

  const totalEmployees = allEmployees.length;
  const empMap = new Map(allEmployees.map((e) => [e.employeeId, e]));

  // Calculate top late-comers for the month accurately
  const lateCountMap: Record<string, number> = {};
  monthlyAttendances.forEach((a) => {
    if (empMap.has(a.employeeId)) {
      lateCountMap[a.employeeId] = (lateCountMap[a.employeeId] || 0) + 1;
    }
  });

  const topLateComers = Object.entries(lateCountMap)
    .map(([empId, count]) => {
      const emp = empMap.get(empId);
      return {
        employeeId: empId,
        name: emp?.name || empId,
        department: emp?.department || 'Operations',
        lateCount: count,
      };
    })
    .sort((a, b) => b.lateCount - a.lateCount)
    .slice(0, 5);

  const departmentDistribution: Record<string, number> = {};
  catalogDepts.forEach((d: any) => {
    if (d.name) {
      departmentDistribution[d.name] = 0;
    }
  });
  allEmployees.forEach((emp) => {
    const dept = emp.department || 'Operations';
    departmentDistribution[dept] = (departmentDistribution[dept] || 0) + 1;
  });

  const validTodayAttendances = todayAttendances.filter((a) => empMap.has(a.employeeId));
  const presentToday = validTodayAttendances.filter((a) =>
    ['present', 'late', 'half-day'].includes(a.status)
  ).length;
  const lateToday = validTodayAttendances.filter((a) => a.isLate).length;
  const onTimeToday = Math.max(0, presentToday - lateToday);

  const distinctLeaveEmpIds = new Set(
    approvedLeavesToday.filter((l) => empMap.has(l.employeeId)).map((l) => l.employeeId)
  );
  const onLeaveToday = distinctLeaveEmpIds.size;
  const absentToday = Math.max(0, totalEmployees - presentToday - onLeaveToday);
  const attendanceRate = totalEmployees > 0 ? Math.min(100, Math.round((presentToday / totalEmployees) * 100)) : 0;

  const enrichedRecentAttendances = validTodayAttendances.slice(0, 15).map((a) => {
    const emp = empMap.get(a.employeeId);
    return {
      ...a,
      employeeName: emp?.name || a.employeeId,
      department: emp?.department || 'Operations',
      designation: emp?.designation || 'Staff',
    };
  });

  const enrichedPendingLeaves = pendingLeaves.map((l) => {
    const emp = empMap.get(l.employeeId);
    return {
      ...l,
      employeeName: emp?.name || l.employeeId,
      department: emp?.department || 'Operations',
      designation: emp?.designation || 'Staff',
    };
  });

  const enrichedClockOutResets = pendingClockOutResets.map((a) => {
    const emp = empMap.get(a.employeeId);
    return {
      ...a,
      employeeName: emp?.name || a.employeeId,
      department: emp?.department || 'Operations',
      designation: emp?.designation || 'Staff',
      reason: a.clockOutResetRequest?.reason || 'Accidental clock-out — requesting shift reopen.',
    };
  });

  return {
    todayStr,
    monthStr,
    cards: {
      headcount: totalEmployees,
      presentToday,
      lateToday,
      onTimeToday,
      absentToday,
      onLeaveToday,
      pendingLeavesCount: actualPendingLeavesCount,
      pendingCorrectionsCount,
      pendingClockOutResetsCount: pendingClockOutResets.length,
      attendanceRate,
    },
    departmentDistribution,
    topLateComers,
    pendingLeaves: enrichedPendingLeaves,
    pendingClockOutResets: enrichedClockOutResets,
    recentAttendances: enrichedRecentAttendances,
  };
};
