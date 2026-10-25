import Employee from '../models/Employee';
import Attendance from '../models/Attendance';
import Leave from '../models/Leave';
import Payslip from '../models/Payslip';
import { Department, LeaveType } from '../models/Org';
import { Settings } from '../models/Settings';
import { getLeaveBalances } from './leave.service';
import { getActorEmployee } from './attendance.service';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';

const getGeminiApiKey = (): string => process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Gather live context for Gemini strictly isolated to:
 * - For 'employee' role: ONLY that single employee's own schema/records (Employee, Attendance, Leave, Payslip) + general company policies. Zero access to any other employee's records or company-wide employee lists.
 * - For 'admin' / 'hr' role: Tenant-scoped company metrics + employee directory within their tenant.
 */
export const gatherContextForRole = async (actor: JWTPayload) => {
  if (!actor || !actor.tenantId) {
    throw new AppError('Tenant workspace context is required for AI queries.', 403);
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);
  const tenantId = actor.tenantId;
  const isSupervisor = actor.role === 'admin' || actor.role === 'hr';

  const [settings, leaveTypes] = await Promise.all([
    Settings.findById(tenantId).lean(),
    LeaveType.find({ tenantId }).sort({ name: 1 }).lean(),
  ]);

  const weekendDays =
    Array.isArray(settings?.weekend) && settings!.weekend.length > 0
      ? settings!.weekend.map((d: number) => WEEKDAY_NAMES[d] || '').filter(Boolean).join(' and ')
      : 'Saturday and Sunday';

  const leaveQuotaStr =
    leaveTypes.length > 0
      ? leaveTypes
          .map((lt: any) => `${lt.name} (${lt.unlimited ? 'Unlimited' : `${lt.annualQuota} days`})`)
          .join(', ')
      : 'Annual (14 days), Sick (8 days), Casual (10 days), Unpaid (Unlimited)';

  const companyPolicies = {
    companyName: settings?.companyName || 'HCM Workspace',
    officeStart: settings?.officeStart || '09:00',
    graceMinutes: settings?.graceMinutes ?? 15,
    halfDayHours: settings?.halfDayHours ?? 5,
    officeLocation:
      settings?.office?.address ||
      (settings?.office?.lat ? `${settings.office.lat}, ${settings.office.lng}` : 'Not configured'),
    geofenceRadiusMeters: settings?.office?.radiusMeters ?? 150,
    weekend: weekendDays,
    leaveQuotas: leaveQuotaStr,
    clockInRule:
      'Single daily clock-in and clock-out per employee. Accidental clock-outs require an HR Clock-Out Reset Application.',
    lateRule: '3 late arrivals = 0.5 day salary deduction',
    payrollFormula:
      'Gross = 1.5 × Basic (HRA 40%, Medical 10%). Daily rate = Gross / 22 working days. Deductions = (absent + unpaid + 0.5 × half days) × daily rate.',
  };

  // ============================================================================
  // STRICT EMPLOYEE ISOLATION: Query ONLY the logged-in employee's own records!
  // Never query Employee.find(), company-wide Attendance, or company-wide Leave!
  // ============================================================================
  if (!isSupervisor) {
    const callerEmp = await getActorEmployee(actor);
    const [actorBalances, callerTodayAtt, callerMonthAtt, callerLeaves, callerPayslips] = await Promise.all([
      getLeaveBalances(callerEmp.employeeId, tenantId),
      Attendance.findOne({
        tenantId,
        employeeId: callerEmp.employeeId,
        date: todayStr,
      }).lean(),
      Attendance.find({
        tenantId,
        employeeId: callerEmp.employeeId,
        date: new RegExp(`^${monthStr}`),
      }).lean(),
      Leave.find({
        tenantId,
        employeeId: callerEmp.employeeId,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Payslip.find({
        tenantId,
        employeeId: callerEmp.employeeId,
        status: 'locked',
      })
        .sort({ month: -1 })
        .limit(3)
        .lean(),
    ]);

    const presentDaysThisMonth = callerMonthAtt.filter(
      (a) => a.status === 'present' || a.status === 'late'
    ).length;
    const lateDaysThisMonth = callerMonthAtt.filter((a) => a.isLate || a.status === 'late').length;
    const halfDaysThisMonth = callerMonthAtt.filter((a) => a.status === 'half-day').length;
    const totalHoursThisMonth =
      Math.round(callerMonthAtt.reduce((acc, a) => acc + (a.workHours || 0), 0) * 10) / 10;

    const myPersonalData = {
      name: callerEmp.name,
      employeeId: callerEmp.employeeId,
      email: callerEmp.email,
      department: callerEmp.department,
      designation: callerEmp.designation,
      dateOfJoining: callerEmp.dateOfJoining,
      assignedShift: {
        shiftName: (callerEmp as any).shiftName || 'Morning Shift',
        shiftStart: (callerEmp as any).shiftStart || companyPolicies.officeStart,
        shiftEnd: (callerEmp as any).shiftEnd || '17:00',
        graceMinutes: (callerEmp as any).shiftGraceMinutes ?? companyPolicies.graceMinutes,
      },
      basicSalary: callerEmp.basicSalary,
      grossSalary: callerEmp.grossSalary || Math.round(callerEmp.basicSalary * 1.5),
      todayAttendanceStatus: callerTodayAtt
        ? {
            status: callerTodayAtt.status,
            checkIn: callerTodayAtt.checkIn,
            checkOut: callerTodayAtt.checkOut || null,
            workHours: callerTodayAtt.workHours || 0,
            isLate: callerTodayAtt.isLate || false,
          }
        : 'Not clocked in yet today',
      monthlyAttendanceSummary: {
        month: monthStr,
        presentDays: presentDaysThisMonth,
        lateDays: lateDaysThisMonth,
        halfDays: halfDaysThisMonth,
        totalHoursWorked: totalHoursThisMonth,
      },
      leaveBalances: actorBalances.map(
        (b: any) =>
          `${b.type}: ${b.remaining} remaining (Quota: ${b.quota}, Used: ${b.used}, Pending: ${b.pending})`
      ),
      recentLeaveRequests: callerLeaves.map((l: any) => ({
        leaveType: l.leaveType,
        startDate: l.startDate,
        endDate: l.endDate,
        daysCount: l.daysCount,
        status: l.status,
      })),
      recentPayslips: callerPayslips.map((p: any) => ({
        month: p.month,
        grossSalary: p.grossSalary,
        netSalary: p.netSalary,
        deductions: p.deductions,
        taxDeduction: p.taxDeduction,
      })),
    };

    return {
      tenantId,
      todayStr,
      monthStr,
      companyPolicies,
      actorScope: {
        role: 'employee',
        email: actor.email,
        actorEmployee: myPersonalData,
      },
    };
  }

  // ============================================================================
  // SUPERVISOR CONTEXT (Owner 'admin' or 'hr' ONLY)
  // ============================================================================
  const [catalogDepts, employees] = await Promise.all([
    Department.find({ tenantId }).sort({ name: 1 }).lean(),
    Employee.find({ tenantId, status: { $ne: 'inactive' }, role: { $ne: 'admin' } })
      .select(
        'employeeId name email department designation role basicSalary grossSalary status shiftName shiftStart shiftEnd'
      )
      .lean(),
  ]);

  const totalEmployees = employees.length;
  const empMap = new Map(employees.map((e: any) => [e.employeeId, e]));

  const deptCounts: Record<string, number> = {};
  catalogDepts.forEach((d: any) => {
    if (d.name) deptCounts[d.name] = 0;
  });
  employees.forEach((e: any) => {
    const d = e.department || 'Operations';
    deptCounts[d] = (deptCounts[d] || 0) + 1;
  });

  const [todayAttendances, activeLeavesToday, monthlyLateRecords] = await Promise.all([
    Attendance.find({ tenantId, date: todayStr }).lean(),
    Leave.find({
      tenantId,
      status: 'approved',
      startDate: { $lte: todayStr },
      endDate: { $gte: todayStr },
    }).lean(),
    Attendance.find({
      tenantId,
      date: new RegExp(`^${monthStr}`),
      isLate: true,
    }).lean(),
  ]);

  const validTodayAtt = todayAttendances.filter((a) => empMap.has(a.employeeId));
  const presentToday = validTodayAtt.filter((a) =>
    ['present', 'late', 'half-day'].includes(a.status)
  ).length;
  const lateToday = validTodayAtt.filter((a) => a.isLate).length;

  const validLeavesToday = activeLeavesToday.filter((l) => empMap.has(l.employeeId));
  const onLeaveDetails = validLeavesToday.map((l) => {
    const emp: any = empMap.get(l.employeeId);
    return `${emp?.name || l.employeeId} (${l.employeeId}, ${l.leaveType}: ${l.startDate} to ${l.endDate})`;
  });

  const lateCountMap: Record<string, number> = {};
  monthlyLateRecords.forEach((a) => {
    if (empMap.has(a.employeeId)) {
      lateCountMap[a.employeeId] = (lateCountMap[a.employeeId] || 0) + 1;
    }
  });
  const topLateComers = Object.entries(lateCountMap)
    .sort((a, b) => b[1] - a[1])
    .map(([empId, count]) => {
      const emp: any = empMap.get(empId);
      return `${emp?.name || empId} (${empId}, ${emp?.department || 'Operations'}): ${count} late arrival(s)`;
    })
    .slice(0, 5);

  let actorInfo: any = null;
  if (actor.role === 'hr') {
    const callerEmp = await getActorEmployee(actor);
    const actorBalances = await getLeaveBalances(callerEmp.employeeId, tenantId);
    actorInfo = {
      name: callerEmp.name,
      employeeId: callerEmp.employeeId,
      department: callerEmp.department,
      designation: callerEmp.designation,
      basicSalary: callerEmp.basicSalary,
      grossSalary: callerEmp.grossSalary || Math.round(callerEmp.basicSalary * 1.5),
      leaveBalances: actorBalances.map(
        (b: any) =>
          `${b.type}: ${b.remaining} remaining (Quota: ${b.quota}, Used: ${b.used}, Pending: ${b.pending})`
      ),
    };
  } else {
    actorInfo = {
      name: actor.email.split('@')[0],
      role: 'Company Owner / Admin',
      designation: 'Company Owner',
    };
  }

  return {
    tenantId,
    todayStr,
    monthStr,
    companyPolicies,
    liveCompanyMetrics: {
      totalHeadcount: totalEmployees,
      departmentDistribution: deptCounts,
      todayAttendance: {
        present: presentToday,
        late: lateToday,
        attendanceRate:
          totalEmployees > 0 ? `${Math.round((presentToday / totalEmployees) * 100)}%` : '0%',
        onLeaveCount: validLeavesToday.length,
        employeesOnLeaveToday: onLeaveDetails,
      },
      topLateComersMonth: topLateComers,
      employeeDirectory: employees.slice(0, 40).map((e: any) => ({
        employeeId: e.employeeId,
        name: e.name,
        department: e.department,
        designation: e.designation,
        role: e.role,
        shiftName: e.shiftName || 'Morning Shift',
        shiftStart: e.shiftStart || companyPolicies.officeStart,
        shiftEnd: e.shiftEnd || '17:00',
        basicSalary: e.basicSalary,
        grossSalary: Math.round((e.basicSalary || 0) * 1.5),
      })),
    },
    actorScope: {
      role: actor.role,
      email: actor.email,
      actorEmployee: actorInfo,
    },
  };
};

/**
 * Handle AI Chat with Google Gemini API & strict Multi-Tenant + Schema-Level Employee Isolation
 */
export const handleAIChat = async (actor: JWTPayload, userMessage: string): Promise<string> => {
  if (!actor || !actor.tenantId) {
    throw new AppError('Tenant workspace context is required.', 403);
  }

  const query = (userMessage || '').trim().toLowerCase();
  const fullContext = await gatherContextForRole(actor);

  // ============================================================================
  // STRICT EMPLOYEE GUARDRAIL:
  // If an employee asks ANY question about other employees, colleagues, company
  // headcount, who is on leave, who is late, or anyone else's data, refuse!
  // ============================================================================
  if (actor.role === 'employee') {
    const callerEmp = fullContext.actorScope.actorEmployee;
    const callerEmpIdLower = String(callerEmp?.employeeId || '').toLowerCase();
    const callerNameParts = String(callerEmp?.name || '')
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length >= 3);

    const asksOtherEmployeesOrOrgWide =
      /\b(other|others|colleague|colleagues|coworker|coworkers|everyone|anyone|someone|staff|employees|team members|directory|list all|who is|who's|whose|how many people|how many employees|headcount|total employees|department headcount|highest|lowest|his|her|their)\b/i.test(
        query
      ) ||
      (query.includes('emp-') && (!callerEmpIdLower || !query.includes(callerEmpIdLower)));

    if (asksOtherEmployeesOrOrgWide) {
      return `I can only access and answer questions about **your own personal employee profile, shift timings, attendance log, leave balances, payslips, and general company policies** at **${fullContext.companyPolicies.companyName}**. Under strict data privacy rules, I do not have access to any other employee's records or organization-wide personnel lists.`;
    }

    // Also block if the query mentions a specific person's name that is not the caller's own name
    const asksSalaryOrRecordOfNamedPerson =
      /\b(salary|pay|gross|basic|leave|attendance|late|shift|department|designation|email|phone|profile|record)\s+(of|for)\s+([a-z]+)/i.exec(
        query
      );
    if (asksSalaryOrRecordOfNamedPerson) {
      const targetWord = asksSalaryOrRecordOfNamedPerson[3].toLowerCase();
      if (
        targetWord !== 'my' &&
        targetWord !== 'me' &&
        targetWord !== 'mine' &&
        !callerNameParts.includes(targetWord)
      ) {
        return `I can only access and answer questions about **your own personal employee profile, shift timings, attendance log, leave balances, payslips, and general company policies** at **${fullContext.companyPolicies.companyName}**. Under strict data privacy rules, I do not have access to any other employee's records.`;
      }
    }
  }

  const systemPrompt =
    actor.role === 'employee'
      ? `You are the personal Employee Self-Service AI Assistant for "${fullContext.actorScope.actorEmployee?.name}" (${fullContext.actorScope.actorEmployee?.employeeId}) at "${fullContext.companyPolicies.companyName}".

CRITICAL DATA ISOLATION RULES:
1. You ONLY have access to this single employee's own schema and records provided below, plus general company policy rules.
2. You have ZERO access to any other employee's data, names, salaries, attendance, leaves, or company headcount.
3. If the user asks about any other employee, colleague, headcount, who is on leave, who is late, or anyone else's information, refuse immediately and state that you only have access to their personal employee records.
4. Keep responses accurate, concise, and formatted in clean Markdown.

EMPLOYEE PERSONAL RECORD & COMPANY POLICIES:
${JSON.stringify(fullContext, null, 2)}
`
      : `You are the official Executive & HR AI Assistant for "${fullContext.companyPolicies.companyName}", embedded inside their isolated HCM Lite enterprise workspace (Tenant ID: ${actor.tenantId}).
The user asking you questions is authenticated with role: "${actor.role}".

CRITICAL MULTI-TENANCY RULES:
1. STRICT TENANT ISOLATION: You represent ONLY "${fullContext.companyPolicies.companyName}". Answer strictly from the LIVE TENANT DATABASE CONTEXT provided below. Never invent employee names, numbers, or policies outside this context.
2. Keep responses accurate, concise, and formatted in clean Markdown.

LIVE TENANT DATABASE CONTEXT:
${JSON.stringify(fullContext, null, 2)}
`;

  // Call Google Gemini API
  try {
    const apiKey = getGeminiApiKey();
    if (apiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nUSER QUESTION: ${userMessage}` }] }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 800,
          },
        }),
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (answer && answer.trim()) {
          return answer.trim();
        }
      }
    }
  } catch (err) {
    console.warn('[Gemini API call warning - using deterministic tenant database answer]:', err);
  }

  return getDeterministicAnswer(actor, userMessage, fullContext);
};

/**
 * Deterministic live tool execution strictly scoped to the current user's role & tenant context
 */
const getDeterministicAnswer = (actor: JWTPayload, message: string, context: any): string => {
  const query = message.toLowerCase();
  const companyName = context.companyPolicies.companyName;
  const isSupervisor = actor.role === 'admin' || actor.role === 'hr';
  const emp = context.actorScope.actorEmployee;

  // Personal salary question
  if (query.includes('salary') || query.includes('pay') || query.includes('gross')) {
    if (emp && emp.basicSalary !== undefined) {
      return `Here is your compensation breakdown at **${companyName}**:\n\n• **Basic Salary**: Rs. ${Number(emp.basicSalary || 0).toLocaleString()}\n• **Gross Salary (1.5× Rule)**: Rs. ${Number(emp.grossSalary || 0).toLocaleString()} (includes 40% HRA & 10% Medical)`;
    }
  }

  // Personal shift question
  if (query.includes('shift') || query.includes('timing')) {
    if (emp?.assignedShift) {
      return `Your assigned shift at **${companyName}** is **${emp.assignedShift.shiftName}** (**${emp.assignedShift.shiftStart} – ${emp.assignedShift.shiftEnd}**, with a **+${emp.assignedShift.graceMinutes} minute** grace window).`;
    }
  }

  // Personal leave balances
  if (
    query.includes('leave') &&
    (query.includes('left') || query.includes('balance') || query.includes('sick') || query.includes('my') || !isSupervisor)
  ) {
    if (emp?.leaveBalances) {
      return `Here is your current live leave balance at **${companyName}** for this calendar year:\n\n${emp.leaveBalances.map((b: string) => `• ${b}`).join('\n')}`;
    }
  }

  // Personal attendance for employee
  if (!isSupervisor && (query.includes('attendance') || query.includes('late') || query.includes('hour'))) {
    if (emp?.monthlyAttendanceSummary) {
      const m = emp.monthlyAttendanceSummary;
      return `Here is your personal attendance summary for **${m.month}** at **${companyName}**:\n\n• **Present Days**: ${m.presentDays}\n• **Late Arrivals**: ${m.lateDays}\n• **Half Days**: ${m.halfDays}\n• **Total Hours Worked**: ${m.totalHoursWorked} hrs`;
    }
  }

  // Supervisor-only queries below
  if (isSupervisor && context.liveCompanyMetrics) {
    if (query.includes('who is on leave') || (query.includes('on leave') && query.includes('today'))) {
      const list = context.liveCompanyMetrics.todayAttendance.employeesOnLeaveToday || [];
      if (list.length === 0) {
        return `No employees at **${companyName}** are on approved leave today (${context.todayStr}).`;
      }
      return `Here are the employees on approved leave today at **${companyName}**:\n\n${list.map((item: string) => `• ${item}`).join('\n')}`;
    }

    if (query.includes('late')) {
      const topLate = context.liveCompanyMetrics.topLateComersMonth || [];
      if (topLate.length > 0) {
        return `Here are the top late arrivals recorded at **${companyName}** for **${context.monthStr}**:\n\n${topLate.map((l: string, i: number) => `${i + 1}. **${l}**`).join('\n')}`;
      }
      return `No employees at **${companyName}** have been marked late during **${context.monthStr}**.`;
    }

    if (query.includes('headcount') || query.includes('how many') || query.includes('department')) {
      const dist = Object.entries(context.liveCompanyMetrics.departmentDistribution)
        .map(([d, c]) => `• **${d}**: ${c} active employee(s)`)
        .join('\n');
      return `**${companyName}** currently has a total headcount of **${context.liveCompanyMetrics.totalHeadcount} active employee(s)**:\n\n${dist || 'No active employees registered yet.'}`;
    }

    if (query.includes('attendance')) {
      return `Today's attendance rate at **${companyName}** is **${context.liveCompanyMetrics.todayAttendance.attendanceRate}**. Out of **${context.liveCompanyMetrics.totalHeadcount}** active staff, **${context.liveCompanyMetrics.todayAttendance.present}** are marked present (${context.liveCompanyMetrics.todayAttendance.late} late arrival(s)).`;
    }
  }

  // Policy Q&A
  if (
    query.includes('policy') ||
    query.includes('rule') ||
    query.includes('grace') ||
    query.includes('hour') ||
    query.includes('weekend') ||
    query.includes('clock')
  ) {
    const p = context.companyPolicies;
    return `**${p.companyName} — Official Workforce Policies**:\n• **Office Start Time**: **${p.officeStart}** (Grace period: **${p.graceMinutes} mins**)\n• **Half-Day Threshold**: Under **${p.halfDayHours} hours**\n• **Daily Clock-In Policy**: ${p.clockInRule}\n• **Weekends**: ${p.weekend}\n• **Leave Quotas**: ${p.leaveQuotas}\n• **Late Deduction Rule**: ${p.lateRule}`;
  }

  if (!isSupervisor) {
    return `I am your personal Employee AI Assistant at **${companyName}**. You can ask me about your own salary breakdown, assigned shift timings, personal attendance log, remaining leave balances, or ${companyName}'s HR policies.`;
  }

  return `I am the AI Assistant for **${companyName}**. You can ask me about real-time attendance rates, department headcount, leave balances, or ${companyName}'s HR policies.`;
};

/**
 * Dashboard summary bullets (Admin & HR) strictly scoped to actor's tenant with accurate real-time phrasing
 */
export const generateDashboardSummary = async (actor: JWTPayload): Promise<string[]> => {
  const context = await gatherContextForRole(actor);
  const metrics = context.liveCompanyMetrics;
  const companyName = context.companyPolicies.companyName;

  if (!metrics) {
    return [`Welcome to **${companyName}**.`];
  }

  const { totalHeadcount, departmentDistribution, todayAttendance, topLateComersMonth } = metrics;
  const deptSummary = Object.entries(departmentDistribution || {})
    .map(([dept, count]) => `${dept}: **${count}**`)
    .join(', ');

  const bullet1 =
    totalHeadcount === 0
      ? `**${companyName}** currently has **0** registered employees. Add employees or import a CSV in the Employees directory to begin tracking attendance.`
      : `**${companyName}** attendance stands at **${todayAttendance.attendanceRate}** today with **${todayAttendance.present} of ${totalHeadcount}** active staff checked in.`;

  const bullet2 =
    todayAttendance.present === 0
      ? `No employees have clocked in yet today (${context.todayStr}). Standard shift starts at **${context.companyPolicies.officeStart}** (+${context.companyPolicies.graceMinutes}m grace window).`
      : todayAttendance.late > 0
      ? `**${todayAttendance.late}** of ${todayAttendance.present} clocked-in employee(s) arrived past the ${context.companyPolicies.graceMinutes}-minute grace threshold today.`
      : `All **${todayAttendance.present}** clocked-in employee(s) today arrived within the ${context.companyPolicies.graceMinutes}-minute grace window.`;

  const bullet3 = `Currently, **${todayAttendance.onLeaveCount}** team member(s) at **${companyName}** are on approved leave today.`;

  const bullet4 =
    topLateComersMonth && topLateComersMonth.length > 0
      ? `Monthly punctuality watch (${context.monthStr}): **${topLateComersMonth[0]}**.`
      : deptSummary
      ? `Department headcount distribution (${totalHeadcount} total staff): ${deptSummary}.`
      : `All departments in **${companyName}** have zero late violations recorded for ${context.monthStr}.`;

  return [bullet1, bullet2, bullet3, bullet4];
};
