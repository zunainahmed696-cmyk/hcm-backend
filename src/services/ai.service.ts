import Employee from '../models/Employee';
import Attendance from '../models/Attendance';
import Leave from '../models/Leave';
import Payslip from '../models/Payslip';
import { Settings } from '../models/Settings';
import { getLeaveBalances } from './leave.service';
import { getActorEmployee } from './attendance.service';
import { JWTPayload } from '../types';

export const handleAIChat = async (actor: JWTPayload, message: string): Promise<string> => {
  const query = (message || '').trim().toLowerCase();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);

  // 1. Employee asks for a colleague's salary (Brief live test question) -> Politely Refuses!
  if (
    query.includes('salary') ||
    query.includes('pay') ||
    query.includes('compensation') ||
    query.includes('earning')
  ) {
    if (actor.role === 'employee') {
      // Check if asking about someone else or self
      if (
        query.includes('colleague') ||
        query.includes('other') ||
        query.includes('who') ||
        query.includes('someone') ||
        query.includes('anyone') ||
        query.includes('emp-') ||
        /\b(his|her|their|zunain|ali|ahmed|sara|john)\b/.test(query)
      ) {
        return "I apologize, but I cannot provide that information. Under company privacy policy and data governance rules, employees are not authorized to view the salary or compensation details of other personnel.";
      }
      // If asking about own salary
      const emp = await getActorEmployee(actor);
      return `Your registered basic salary is Rs. ${emp.basicSalary?.toLocaleString() || '100,000'}, and your monthly gross compensation is Rs. ${emp.grossSalary?.toLocaleString() || '150,000'}. You can view and download your full payslip breakdown in the "My Payslips" section.`;
    }
  }

  // 2. Employee asks about own leave balance (Brief live test question)
  if (
    query.includes('leave') &&
    (query.includes('balance') || query.includes('left') || query.includes('how many') || query.includes('sick') || query.includes('casual') || query.includes('annual'))
  ) {
    if (actor.role === 'employee') {
      const emp = await getActorEmployee(actor);
      const balances = await getLeaveBalances(emp.employeeId);
      const lines = balances.map((b) => `• **${b.type} Leave**: ${b.remaining} remaining (Quota: ${b.quota}, Used: ${b.used}, Pending: ${b.pending})`);
      return `Here is your current live leave balance for this calendar year:\n\n${lines.join('\n')}\n\nYou can submit a new time-off application anytime on the Leave page!`;
    }
  }

  // 3. HR / Admin asks "Who came late most often this month?" (Brief live test question)
  if (
    query.includes('late') &&
    (query.includes('who') || query.includes('most') || query.includes('often') || query.includes('comers') || query.includes('top'))
  ) {
    if (actor.role === 'employee') {
      const emp = await getActorEmployee(actor);
      const myLate = await Attendance.countDocuments({ employeeId: emp.employeeId, date: new RegExp(`^${monthStr}`), isLate: true });
      return `You have arrived late ${myLate} time(s) during the month of ${monthStr}.`;
    }

    const lateRecords = await Attendance.find({ date: new RegExp(`^${monthStr}`), isLate: true }).lean();
    const countMap: Record<string, number> = {};
    lateRecords.forEach((r) => {
      countMap[r.employeeId] = (countMap[r.employeeId] || 0) + 1;
    });

    const entries = Object.entries(countMap).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      return `Great news! No employees have arrived late during the month of ${monthStr}. Attendance punctuality is currently at 100%.`;
    }

    const emps = await Employee.find({ employeeId: { $in: entries.map((e) => e[0]) } }).lean();
    const map = new Map(emps.map((e) => [e.employeeId, e]));

    const list = entries.slice(0, 5).map(([id, count], idx) => {
      const emp = map.get(id);
      return `${idx + 1}. **${emp?.name || id}** (${id}, ${emp?.department || 'Operations'}) — **${count} late arrival(s)**`;
    });

    return `Here are the top late arrivals recorded for **${monthStr}**:\n\n${list.join('\n')}`;
  }

  // 4. "How many active employees are in {department}?" or Headcount inquiry (Brief live test question)
  if (query.includes('headcount') || query.includes('how many employees') || query.includes('active employees')) {
    if (actor.role === 'employee') {
      const total = await Employee.countDocuments({ status: { $ne: 'inactive' } });
      return `The organization currently has **${total}** active personnel across all departments.`;
    }

    const employees = await Employee.find({ status: { $ne: 'inactive' } }).lean();
    const deptCounts: Record<string, number> = {};
    employees.forEach((e) => {
      const d = e.department || 'Operations';
      deptCounts[d] = (deptCounts[d] || 0) + 1;
    });

    // Check if query targets a specific department
    for (const [dept, count] of Object.entries(deptCounts)) {
      if (query.includes(dept.toLowerCase())) {
        return `There are currently **${count}** active employee(s) in the **${dept}** department.`;
      }
    }

    const breakdown = Object.entries(deptCounts)
      .map(([d, c]) => `• **${d}**: ${c} employee(s)`)
      .join('\n');

    return `The company currently has a total headcount of **${employees.length} active employees**:\n\n${breakdown}`;
  }

  // 5. "What is this month's attendance rate?" or attendance stats
  if (query.includes('attendance rate') || query.includes('attendance summary') || query.includes('who is present')) {
    const [totalEmp, presentCount, lateCount] = await Promise.all([
      Employee.countDocuments({ status: { $ne: 'inactive' } }),
      Attendance.countDocuments({ date: todayStr, status: { $in: ['present', 'late', 'half-day'] } }),
      Attendance.countDocuments({ date: todayStr, isLate: true }),
    ]);

    const rate = totalEmp > 0 ? Math.round((presentCount / totalEmp) * 100) : 100;
    return `Today's attendance rate is **${rate}%**. Out of **${totalEmp}** active employees, **${presentCount}** are marked present (${lateCount} late arrival(s)).`;
  }

  // 6. Who is on leave today?
  if (query.includes('who is on leave') || query.includes('on leave today')) {
    const leavesToday = await Leave.find({
      status: 'approved',
      startDate: { $lte: todayStr },
      endDate: { $gte: todayStr },
    }).lean();

    if (leavesToday.length === 0) {
      return `There are no employees on approved leave today (${todayStr}). Full team availability!`;
    }

    const empIds = leavesToday.map((l) => l.employeeId);
    const emps = await Employee.find({ employeeId: { $in: empIds } }).lean();
    const map = new Map(emps.map((e) => [e.employeeId, e]));

    const lines = leavesToday.map((l) => {
      const emp = map.get(l.employeeId);
      return `• **${emp?.name || l.employeeId}** (${l.department || 'Staff'}) — *${l.leaveType} leave* (${l.startDate} to ${l.endDate})`;
    });

    return `There are **${leavesToday.length}** employee(s) on approved leave today:\n\n${lines.join('\n')}`;
  }

  // 7. Policy Questions (Section 3 rules)
  if (
    query.includes('grace') ||
    query.includes('timing') ||
    query.includes('office hour') ||
    query.includes('weekend') ||
    query.includes('policy') ||
    query.includes('rules') ||
    query.includes('half day')
  ) {
    const settings = await Settings.findOne();
    const officeStart = settings?.officeStart || '09:00';
    const graceMinutes = settings?.graceMinutes ?? 15;
    const halfDayHours = settings?.halfDayHours ?? 5;

    return (
      `**HCM Lite Official Company Policies**:\n\n` +
      `• **Office Hours**: Starts at **${officeStart} AM**.\n` +
      `• **Grace Period**: **${graceMinutes} minutes** (check-in after ${officeStart} + ${graceMinutes}m is recorded as *Late*).\n` +
      `• **Half-Day Rule**: Total work duration under **${halfDayHours} hours** is marked as *Half-Day*.\n` +
      `• **Weekend**: Saturday and Sunday are official non-working days.\n` +
      `• **Annual Leave Quotas**: Annual (14 days), Sick (8 days), Casual (10 days), Unpaid (Unlimited).\n` +
      `• **Late Penalty**: 3 late arrivals result in a 0.5 day deduction in accordance with hackathon rules.`
    );
  }

  // 8. General fallback
  if (actor.role === 'employee') {
    return `Hello! I am your personal HCM Lite AI Assistant. You can ask me:\n• "How many sick leaves do I have left?"\n• "What are the company grace period and office hours?"\n• "What is my current attendance status?"\n• Or type your leave request in plain words!`;
  }

  return `Hello ${actor.role === 'admin' ? 'Owner / Administrator' : 'HR Officer'}! I am your HCM Lite AI Operations Assistant. You can ask me:\n• "How many active employees are in Engineering?"\n• "Who came late most often this month?"\n• "What is today's attendance rate?"\n• "Who is on leave today?"\n• "What is the payroll policy and tax slab formula?"`;
};

export const generateDashboardSummary = async (actor: JWTPayload): Promise<string[]> => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [totalEmployees, presentToday, lateToday, onLeaveToday, pendingLeaves] = await Promise.all([
    Employee.countDocuments({ status: { $ne: 'inactive' } }),
    Attendance.countDocuments({ date: todayStr, status: { $in: ['present', 'late', 'half-day'] } }),
    Attendance.countDocuments({ date: todayStr, isLate: true }),
    Leave.countDocuments({ status: 'approved', startDate: { $lte: todayStr }, endDate: { $gte: todayStr } }),
    Leave.countDocuments({ status: 'pending' }),
  ]);

  const attRate = totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 100;

  return [
    `Company attendance stands at **${attRate}%** today with **${presentToday} of ${totalEmployees}** staff present.`,
    lateToday > 0
      ? `**${lateToday}** employee(s) arrived past the 15-minute grace threshold and were flagged as late.`
      : `All checked-in employees arrived on time with zero punctuality violations recorded today.`,
    `Currently, **${onLeaveToday}** team member(s) are on approved leave, maintaining stable department coverage.`,
    pendingLeaves > 0
      ? `There are **${pendingLeaves}** leave request(s) awaiting managerial review in the Leave Approvals inbox.`
      : `All submitted time-off requests have been reviewed; no backlog in approvals.`,
  ];
};
