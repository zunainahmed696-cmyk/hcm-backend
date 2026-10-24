import Attendance from '../models/Attendance';
import Leave from '../models/Leave';
import Employee from '../models/Employee';
import Payslip from '../models/Payslip';
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
        employeeId: employee.employeeId,
        date: new RegExp(`^${currentMonth}`),
      }),
      Attendance.findOne({
        employeeId: employee.employeeId,
        date: todayStr,
      }),
      getLeaveBalances(employee.employeeId),
      getMyInbox(actor),
      Settings.findOne(),
      Payslip.findOne({ employeeId: employee.employeeId }).sort({ month: -1 }),
    ]);

  const presentCount = attendancesThisMonth.filter((a) => a.status === 'present' || a.status === 'late').length;
  const lateCount = attendancesThisMonth.filter((a) => a.isLate || a.status === 'late').length;
  const halfDayCount = attendancesThisMonth.filter((a) => a.status === 'half-day').length;
  const totalHours = Math.round(attendancesThisMonth.reduce((acc, a) => acc + (a.workHours || 0), 0) * 10) / 10;

  // Total working days in month so far
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
    },
    metrics: {
      currentMonth,
      todayStr,
      presentCount,
      lateCount,
      halfDayCount,
      totalHours,
      totalLeaveDaysRemaining,
    },
    today: {
      checkedIn: !!todayAttendance,
      checkedOut: !!todayAttendance?.checkOut,
      checkInTime: todayAttendance?.checkIn,
      checkOutTime: todayAttendance?.checkOut,
      status: todayAttendance?.status || 'not_marked',
      workHours: todayAttendance?.workHours || 0,
      isLate: todayAttendance?.isLate || false,
      lateMinutes: todayAttendance?.lateMinutes || 0,
    },
    leaveBalances: balances,
    announcements: inbox.announcements.slice(0, 3),
    notifications: inbox.notifications.slice(0, 3),
    unreadCount: inbox.unreadCount,
    settings: {
      officeStart: settings?.officeStart || '09:00',
      graceMinutes: settings?.graceMinutes ?? 15,
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

export const getAdminDashboardData = async () => {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [
    totalEmployees,
    presentToday,
    lateToday,
    hrCount,
    onLeaveToday,
    pendingLeaveCount,
    recentAttendances,
    pendingLeaves,
  ] = await Promise.all([
    Employee.countDocuments({ status: { $ne: 'inactive' } }),
    Attendance.countDocuments({ date: todayStr, status: { $in: ['present', 'late', 'half-day'] } }),
    Attendance.countDocuments({ date: todayStr, isLate: true }),
    User.countDocuments({ role: 'hr', isActive: true }),
    Leave.countDocuments({ status: 'approved', startDate: { $lte: todayStr }, endDate: { $gte: todayStr } }),
    Leave.countDocuments({ status: 'pending' }),
    Attendance.find({ date: todayStr }).sort({ checkIn: -1 }).limit(5).lean(),
    Leave.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  // Enrich recent attendances with names
  const attEmpIds = recentAttendances.map((a) => a.employeeId);
  const leaveEmpIds = pendingLeaves.map((l) => l.employeeId);
  const allEmpIds = [...new Set([...attEmpIds, ...leaveEmpIds])];
  const employees = await Employee.find({ employeeId: { $in: allEmpIds } }).lean();
  const empMap = new Map(employees.map((e) => [e.employeeId, e]));

  const enrichedRecentAttendances = recentAttendances.map((a) => {
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

  return {
    todayStr,
    cards: {
      attendance: {
        present: presentToday,
        total: totalEmployees,
        late: lateToday,
        displayValue: `${presentToday} / ${totalEmployees}`,
        subtext: lateToday > 0 ? `${lateToday} late arrival(s) today` : 'All on time today',
      },
      totalHR: {
        count: hrCount,
        displayValue: `${hrCount}`,
        subtext: 'Active HR Officers provisioned',
      },
      onLeave: {
        count: onLeaveToday,
        pending: pendingLeaveCount,
        displayValue: `${onLeaveToday}`,
        subtext: `${pendingLeaveCount} pending review request(s)`,
      },
    },
    recentAttendances: enrichedRecentAttendances,
    pendingLeaves: enrichedPendingLeaves,
  };
};

export const getHRDashboardData = async () => {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);

  const [
    totalEmployees,
    presentToday,
    lateToday,
    onLeaveToday,
    pendingLeaves,
    pendingCorrectionsCount,
    recentAttendances,
    monthlyAttendances,
    allEmployees,
  ] = await Promise.all([
    Employee.countDocuments({ status: { $ne: 'inactive' } }),
    Attendance.countDocuments({ date: todayStr, status: { $in: ['present', 'late', 'half-day'] } }),
    Attendance.countDocuments({ date: todayStr, isLate: true }),
    Leave.countDocuments({ status: 'approved', startDate: { $lte: todayStr }, endDate: { $gte: todayStr } }),
    Leave.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10).lean(),
    Attendance.countDocuments({ 'correctionRequest.status': 'pending' }),
    Attendance.find({ date: todayStr }).sort({ checkIn: -1 }).limit(8).lean(),
    Attendance.find({ date: new RegExp(`^${monthStr}`), isLate: true }).lean(),
    Employee.find({ status: { $ne: 'inactive' } }).lean(),
  ]);

  const empMap = new Map(allEmployees.map((e) => [e.employeeId, e]));

  // Calculate top late-comers for the month
  const lateCountMap: Record<string, number> = {};
  monthlyAttendances.forEach((a) => {
    lateCountMap[a.employeeId] = (lateCountMap[a.employeeId] || 0) + 1;
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

  const enrichedRecentAttendances = recentAttendances.map((a) => {
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

  return {
    todayStr,
    monthStr,
    cards: {
      headcount: totalEmployees,
      presentToday,
      lateToday,
      onLeaveToday,
      pendingLeavesCount: pendingLeaves.length,
      pendingCorrectionsCount,
      attendanceRate: totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 100,
    },
    topLateComers,
    pendingLeaves: enrichedPendingLeaves,
    recentAttendances: enrichedRecentAttendances,
  };
};


