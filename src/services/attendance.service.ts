import Attendance from '../models/Attendance';
import Employee from '../models/Employee';
import Leave from '../models/Leave';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { Settings } from '../models/Settings';
import { Holiday } from '../models/Org';
import { recordAudit } from './audit.service';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';

export const getActorEmployee = async (actor: JWTPayload) => {
  // Company Owners (role: 'admin') are never employees and must never be inserted into the Employee collection.
  if (actor.role === 'admin') {
    const userDoc = await User.findById(actor.userId).lean();
    return {
      _id: actor.userId,
      tenantId: actor.tenantId,
      employeeId: `OWNER-${String(actor.userId).slice(-4).toUpperCase()}`,
      userId: actor.userId,
      name: userDoc?.name || actor.email.split('@')[0],
      fatherName: '',
      email: actor.email,
      phone: '',
      address: '',
      department: 'Executive Management',
      designation: 'Company Owner',
      role: 'admin',
      dateOfJoining: new Date().toISOString().slice(0, 10),
      basicSalary: 0,
      grossSalary: 0,
      status: 'active',
    } as any;
  }

  let employee = await Employee.findOne({ userId: actor.userId, tenantId: actor.tenantId });
  if (!employee) {
    employee = await Employee.findOne({ email: actor.email, tenantId: actor.tenantId });
    if (employee) {
      let changed = false;
      if (!employee.userId) {
        employee.userId = actor.userId as any;
        changed = true;
      }
      if (!employee.tenantId || employee.tenantId.toString() !== actor.tenantId) {
        employee.tenantId = actor.tenantId as any;
        changed = true;
      }
      if (changed) await employee.save();
    } else {
      const userDoc = await User.findById(actor.userId);
      const codeSuffix = String(actor.userId).slice(-4).toUpperCase();
      employee = await Employee.create({
        tenantId: actor.tenantId as any,
        employeeId: `EMP-${codeSuffix}`,
        userId: actor.userId as any,
        name: userDoc?.name || actor.email.split('@')[0],
        fatherName: 'Not Specified',
        email: actor.email,
        phone: '',
        address: '',
        department: 'Engineering',
        designation: actor.role === 'hr' ? 'HR Officer' : 'Software Engineer',
        role: actor.role,
        dateOfJoining: new Date().toISOString().slice(0, 10),
        basicSalary: 100000,
        status: 'active',
      });
    }
  }
  return employee;
};

const getLocalDateStr = (d: Date = new Date()): string => {
  return d.toISOString().slice(0, 10);
};

export const checkIn = async (
  actor: JWTPayload,
  input: {
    lat?: number;
    lng?: number;
    address?: string;
    photo?: string;
  }
) => {
  const employee = await getActorEmployee(actor);
  const now = new Date();
  const todayStr = getLocalDateStr(now);

  // Enforce strict once-per-day clock-in/clock-out policy
  const existing = await Attendance.findOne({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    date: todayStr,
  });
  if (existing) {
    if (existing.checkOut) {
      throw new AppError(
        'You have already clocked in and clocked out for today. Multiple daily clock-ins are not permitted. If you clocked out accidentally, please submit a Clock-Out Reset Application to HR.',
        409
      );
    }
    throw new AppError('You have already clocked in today.', 409);
  }

  const settings = await Settings.findById(actor.tenantId);
  const officeStart = (employee as any).shiftStart || settings?.officeStart || '09:00';
  const graceMinutes = (employee as any).shiftGraceMinutes ?? settings?.graceMinutes ?? 15;

  const [startH, startM] = officeStart.split(':').map(Number);
  const startThreshold = new Date(now);
  startThreshold.setHours(startH, startM + graceMinutes, 0, 0);

  const isLate = now.getTime() > startThreshold.getTime();
  const lateMinutes = isLate ? Math.max(1, Math.round((now.getTime() - startThreshold.getTime()) / 60000)) : 0;
  const status = isLate ? 'late' : 'present';

  const attendance = await Attendance.create({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    userId: actor.userId,
    date: todayStr,
    checkIn: now,
    status,
    isLate,
    lateMinutes,
    checkInLocation: {
      lat: input.lat,
      lng: input.lng,
      address: input.address,
    },
    checkInPhoto: input.photo,
  });

  await recordAudit({
    actor,
    action: 'CREATE',
    entity: 'Attendance',
    entityId: attendance._id.toString(),
    after: {
      employeeId: attendance.employeeId,
      date: attendance.date,
      checkIn: attendance.checkIn,
      status: attendance.status,
      isLate: attendance.isLate,
      lateMinutes: attendance.lateMinutes,
    },
  });

  // Notify Owner (Admin) and HR officers in the same tenant of employee clock-in
  try {
    const supervisors = await User.find({
      tenantId: actor.tenantId,
      role: { $in: ['admin', 'hr'] },
      isActive: true,
    });
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusDesc = isLate ? `Late by ${lateMinutes}m` : 'On Time (Present)';
    await Promise.all(
      supervisors.map((s) =>
        Notification.create({
          tenantId: actor.tenantId,
          type: 'notification',
          title: `Clock In: ${employee.name}`,
          message: `${employee.name} (${employee.employeeId}, ${employee.department}) clocked in at ${timeStr} — ${statusDesc}.`,
          category: 'attendance',
          priority: isLate ? 'high' : 'normal',
          recipientUserId: s._id,
          senderName: 'Attendance Terminal',
          link: '/attendance',
        })
      )
    );
  } catch (err) {
    console.error('[Notification Error - Clock In]:', err);
  }

  return attendance;
};

export const checkOut = async (
  actor: JWTPayload,
  input: {
    lat?: number;
    lng?: number;
    address?: string;
    photo?: string;
  }
) => {
  const employee = await getActorEmployee(actor);
  const now = new Date();
  const todayStr = getLocalDateStr(now);

  const attendance = await Attendance.findOne({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    date: todayStr,
  });
  if (!attendance) {
    throw new AppError('No check-in record found for today. Please check in first.', 404);
  }
  if (attendance.checkOut) {
    throw new AppError(
      'You have already clocked out today. If you clocked out accidentally, please submit a Clock-Out Reset Application to HR.',
      400
    );
  }

  const settings = await Settings.findById(actor.tenantId);
  const halfDayHours = settings?.halfDayHours ?? 5;

  const durationMs = now.getTime() - attendance.checkIn.getTime();
  const workHours = Math.round((durationMs / 3600000) * 10) / 10;

  attendance.checkOut = now;
  attendance.workHours = workHours;
  if (input.lat || input.lng || input.address) {
    attendance.checkOutLocation = {
      lat: input.lat,
      lng: input.lng,
      address: input.address,
    };
  }
  if (input.photo) {
    attendance.checkOutPhoto = input.photo;
  }

  // If work hours are less than half-day threshold, mark half-day
  if (workHours < halfDayHours && attendance.status !== 'absent') {
    attendance.status = 'half-day';
  }

  await attendance.save();

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'Attendance',
    entityId: attendance._id.toString(),
    after: {
      employeeId: attendance.employeeId,
      date: attendance.date,
      checkOut: attendance.checkOut,
      workHours: attendance.workHours,
      status: attendance.status,
    },
  });

  // Notify Owner (Admin) and HR officers in the same tenant of employee clock-out
  try {
    const supervisors = await User.find({
      tenantId: actor.tenantId,
      role: { $in: ['admin', 'hr'] },
      isActive: true,
    });
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await Promise.all(
      supervisors.map((s) =>
        Notification.create({
          tenantId: actor.tenantId,
          type: 'notification',
          title: `Clock Out: ${employee.name}`,
          message: `${employee.name} (${employee.employeeId}) clocked out at ${timeStr}. Shift duration: ${workHours}h (${attendance.status}).`,
          category: 'attendance',
          priority: 'normal',
          recipientUserId: s._id,
          senderName: 'Attendance Terminal',
          link: '/attendance',
        })
      )
    );
  } catch (err) {
    console.error('[Notification Error - Clock Out]:', err);
  }

  return attendance;
};

/**
 * Employee submits an application to HR to reset an accidental clock-out so they can continue their shift
 */
export const requestClockOutReset = async (
  actor: JWTPayload,
  input: {
    reason?: string;
    date?: string;
  }
) => {
  const reason = (input.reason || '').trim() || 'Accidental clock-out — requesting HR to reopen active shift.';

  const employee = await getActorEmployee(actor);
  const targetDate = input.date || getLocalDateStr();

  const attendance = await Attendance.findOne({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    date: targetDate,
  });

  if (!attendance || !attendance.checkOut) {
    throw new AppError('No completed clock-out record found for today to reset. Please clock in and clock out first.', 400);
  }

  attendance.clockOutResetRequest = {
    status: 'pending',
    reason,
    requestedAt: new Date(),
  };

  await attendance.save();

  await recordAudit({
    actor,
    action: 'CREATE',
    entity: 'ClockOutResetRequest',
    entityId: attendance._id.toString(),
    after: {
      employeeId: attendance.employeeId,
      date: attendance.date,
      reason,
      status: 'pending',
    },
  });

  // Notify HR & Admin in the same tenant
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
          title: `Clock-Out Reset Request: ${employee.name}`,
          message: `${employee.name} (${employee.employeeId}, ${employee.department}) applied to reset their clock-out for ${targetDate}. Reason: "${reason}".`,
          category: 'attendance',
          priority: 'high',
          recipientUserId: s._id,
          senderName: employee.name,
          link: '/attendance',
        })
      )
    );
  } catch (err) {
    console.error('[Notification Error - Clock-Out Reset Request]:', err);
  }

  return attendance;
};

/**
 * HR or Admin resets an employee's clock-out (either approving a pending application or performing a direct HR reset)
 * or rejects a pending clock-out reset application.
 */
export const resetEmployeeClockOut = async (
  actor: JWTPayload,
  attendanceId: string,
  input: {
    decision?: 'approved' | 'rejected';
    notes?: string;
  }
) => {
  if (actor.role !== 'admin' && actor.role !== 'hr') {
    throw new AppError('Only HR officers and Administrators can reset employee clock-outs.', 403);
  }

  const attendance = await Attendance.findOne({ _id: attendanceId, tenantId: actor.tenantId });
  if (!attendance) {
    throw new AppError('Attendance record not found.', 404);
  }

  const decision = input.decision || 'approved';
  const notes = input.notes?.trim() || '';
  const reviewer = await User.findById(actor.userId);
  const reviewerName = reviewer?.name || actor.email;

  if (decision === 'rejected') {
    attendance.clockOutResetRequest = {
      status: 'rejected',
      reason: attendance.clockOutResetRequest?.reason || 'Clock-out reset request',
      requestedAt: attendance.clockOutResetRequest?.requestedAt || new Date(),
      reviewedBy: actor.userId as any,
      reviewedAt: new Date(),
      hrNotes: notes || 'Application declined by HR.',
    };

    await attendance.save();

    await recordAudit({
      actor,
      action: 'REJECT',
      entity: 'ClockOutResetRequest',
      entityId: attendance._id.toString(),
      after: {
        employeeId: attendance.employeeId,
        date: attendance.date,
        status: 'rejected',
        hrNotes: attendance.clockOutResetRequest.hrNotes,
      },
    });

    try {
      await Notification.create({
        tenantId: actor.tenantId,
        type: 'notification',
        title: 'Clock-Out Reset Application Declined',
        message: `Your application to reset clock-out for ${attendance.date} was declined by ${reviewerName}.${notes ? ` Note: "${notes}".` : ''}`,
        category: 'attendance',
        priority: 'high',
        recipientUserId: attendance.userId,
        senderName: reviewerName,
        link: '/clockin-out',
      });
    } catch (err) {
      console.error('[Notification Error - Clock-Out Reset Reject]:', err);
    }

    return attendance;
  }

  // Approved or Direct Reset by HR / Admin:
  if (!attendance.checkOut) {
    throw new AppError('This employee does not have a clock-out recorded to reset.', 400);
  }

  const beforeState = {
    checkOut: attendance.checkOut,
    workHours: attendance.workHours,
    status: attendance.status,
    clockOutResetRequest: attendance.clockOutResetRequest,
  };

  const restoredStatus = attendance.isLate ? 'late' : 'present';
  const updatedResetRequest = {
    status: 'approved' as const,
    reason: attendance.clockOutResetRequest?.reason || 'Direct HR clock-out reset',
    requestedAt: attendance.clockOutResetRequest?.requestedAt || new Date(),
    reviewedBy: actor.userId as any,
    reviewedAt: new Date(),
    hrNotes: notes || 'Clock-out reset by HR. Active shift restored.',
  };

  // Atomically unset checkOut, checkOutLocation, and checkOutPhoto in MongoDB
  const updatedAttendance = await Attendance.findOneAndUpdate(
    { _id: attendanceId, tenantId: actor.tenantId },
    {
      $unset: {
        checkOut: 1,
        checkOutLocation: 1,
        checkOutPhoto: 1,
      },
      $set: {
        workHours: 0,
        status: restoredStatus,
        clockOutResetRequest: updatedResetRequest,
      },
    },
    { new: true }
  );

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'Attendance',
    entityId: attendance._id.toString(),
    before: beforeState,
    after: {
      employeeId: attendance.employeeId,
      date: attendance.date,
      checkOut: null,
      workHours: 0,
      status: restoredStatus,
      clockOutResetStatus: 'approved',
      hrNotes: updatedResetRequest.hrNotes,
    },
  });

  try {
    await Notification.create({
      tenantId: actor.tenantId,
      type: 'notification',
      title: 'Clock-Out Reset Approved — Shift Active',
      message: `${reviewerName} has reset your clock-out for ${attendance.date}. Your shift is now active again and you can clock out when your workday ends.${notes ? ` HR Note: "${notes}".` : ''}`,
      category: 'attendance',
      priority: 'high',
      recipientUserId: attendance.userId,
      senderName: reviewerName,
      link: '/clockin-out',
    });
  } catch (err) {
    console.error('[Notification Error - Clock-Out Reset Approve]:', err);
  }

  return updatedAttendance || attendance;
};

export const getTodayStatus = async (actor: JWTPayload) => {
  const employee = await getActorEmployee(actor);
  const todayStr = getLocalDateStr();
  const [attendance, settings, holiday] = await Promise.all([
    Attendance.findOne({ tenantId: actor.tenantId, employeeId: employee.employeeId, date: todayStr }),
    Settings.findById(actor.tenantId),
    Holiday.findOne({ tenantId: actor.tenantId, date: todayStr }),
  ]);

  const effectiveStart = (employee as any).shiftStart || settings?.officeStart || '09:00';
  const effectiveEnd = (employee as any).shiftEnd || '17:00';
  const effectiveShiftName = (employee as any).shiftName || 'Morning Shift';
  const effectiveGrace = (employee as any).shiftGraceMinutes ?? settings?.graceMinutes ?? 15;
  const weekendDays = settings?.weekend || [0, 6];
  const isWeekend = weekendDays.includes(new Date().getDay());

  const statusLabelMap: Record<string, string> = {
    present: 'Present',
    late: 'Late',
    'half-day': 'Half-Day',
    absent: 'Absent',
  };

  const normalizedAtt = attendance
    ? {
        ...attendance.toObject(),
        status: statusLabelMap[attendance.status] || 'Present',
        workingHours: attendance.workHours || 0,
        checkInLocation: attendance.checkInLocation?.lat
          ? {
              lat: attendance.checkInLocation.lat,
              lng: attendance.checkInLocation.lng || 0,
              withinGeofence: true,
              distanceMeters: 0,
            }
          : null,
      }
    : null;

  const pendingResetRequest =
    attendance?.clockOutResetRequest?.status === 'pending'
      ? {
          _id: attendance._id.toString(),
          reason: attendance.clockOutResetRequest.reason || 'Accidental clock-out',
          createdAt: (attendance.clockOutResetRequest.requestedAt || attendance.updatedAt).toISOString(),
        }
      : null;

  return {
    today: todayStr,
    employee: {
      employeeId: employee.employeeId,
      name: employee.name,
      fullName: employee.name,
      department: employee.department,
      designation: employee.designation,
      shiftName: effectiveShiftName,
      shiftStart: effectiveStart,
      shiftEnd: effectiveEnd,
      shiftGraceMinutes: effectiveGrace,
    },
    attendance: normalizedAtt,
    settings: {
      officeStart: effectiveStart,
      shiftEnd: effectiveEnd,
      shiftName: effectiveShiftName,
      graceMinutes: effectiveGrace,
      halfDayHours: settings?.halfDayHours ?? 5,
      weekend: weekendDays,
      office: settings?.office,
    },
    policy: {
      shiftName: effectiveShiftName,
      officeStart: effectiveStart,
      officeEnd: effectiveEnd,
      graceMinutes: effectiveGrace,
      halfDayHours: settings?.halfDayHours ?? 5,
      office: settings?.office,
    },
    isWeekend,
    isHoliday: !!holiday,
    holidayName: holiday?.name || null,
    pendingResetRequest,
    serverTime: new Date().toISOString(),
  };
};

export const getMyCalendar = async (actor: JWTPayload, monthQuery?: string) => {
  const employee = await getActorEmployee(actor);
  const month = monthQuery || new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthRegex = new RegExp(`^${month}`);

  const [attendances, holidays, settings] = await Promise.all([
    Attendance.find({ tenantId: actor.tenantId, employeeId: employee.employeeId, date: monthRegex }).sort({ date: 1 }),
    Holiday.find({ tenantId: actor.tenantId, date: monthRegex }),
    Settings.findById(actor.tenantId),
  ]);

  return {
    month,
    employeeId: employee.employeeId,
    attendances,
    holidays: holidays.map((h) => ({ name: h.name, date: h.date })),
    weekend: settings?.weekend || [0, 6],
    officeStart: settings?.officeStart || '09:00',
    graceMinutes: settings?.graceMinutes ?? 15,
    halfDayHours: settings?.halfDayHours ?? 5,
  };
};

export const requestCorrection = async (
  actor: JWTPayload,
  input: {
    date: string;
    requestedCheckIn: string;
    requestedCheckOut?: string;
    reason: string;
  }
) => {
  if (!input.date) throw new AppError('Date is required for attendance correction.', 422);
  if (!input.requestedCheckIn) throw new AppError('Requested check-in time is required.', 422);
  if (!input.reason?.trim()) throw new AppError('Correction reason is mandatory.', 422);

  const employee = await getActorEmployee(actor);

  let attendance = await Attendance.findOne({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    date: input.date,
  });
  if (!attendance) {
    // Create placeholder attendance for missing record
    attendance = new Attendance({
      tenantId: actor.tenantId,
      employeeId: employee.employeeId,
      userId: actor.userId,
      date: input.date,
      checkIn: new Date(input.requestedCheckIn),
      status: 'absent',
    });
  }

  attendance.correctionRequest = {
    status: 'pending',
    requestedCheckIn: new Date(input.requestedCheckIn),
    requestedCheckOut: input.requestedCheckOut ? new Date(input.requestedCheckOut) : undefined,
    reason: input.reason.trim(),
    requestedAt: new Date(),
  };

  await attendance.save();

  await recordAudit({
    actor,
    action: 'CREATE',
    entity: 'AttendanceCorrection',
    entityId: attendance._id.toString(),
    after: {
      employeeId: attendance.employeeId,
      date: attendance.date,
      correctionRequest: attendance.correctionRequest,
    },
  });

  return attendance;
};

export const getMyCorrectionRequests = async (actor: JWTPayload, statusFilter?: string) => {
  // If HR or Admin requests pending applications for the Attendance Board
  if ((actor.role === 'admin' || actor.role === 'hr') && statusFilter) {
    const [pendingCorrections, pendingResets] = await Promise.all([
      Attendance.find({
        tenantId: actor.tenantId,
        'correctionRequest.status': 'pending',
      }).lean(),
      Attendance.find({
        tenantId: actor.tenantId,
        'clockOutResetRequest.status': 'pending',
      }).lean(),
    ]);

    const empIds = [
      ...new Set([
        ...pendingCorrections.map((a) => a.employeeId),
        ...pendingResets.map((a) => a.employeeId),
      ]),
    ];
    const employees = await Employee.find({
      tenantId: actor.tenantId,
      employeeId: { $in: empIds },
    }).lean();
    const empMap = new Map(employees.map((e) => [e.employeeId, e]));

    const combined: any[] = [];
    for (const r of pendingResets) {
      const emp = empMap.get(r.employeeId);
      combined.push({
        _id: r._id.toString(),
        employeeId: r.employeeId,
        employee: { fullName: emp?.name || r.employeeId, department: emp?.department || '' },
        date: r.date,
        requestType: 'clockout_reset',
        reason: r.clockOutResetRequest?.reason || 'Accidental clock-out',
        createdAt: r.clockOutResetRequest?.requestedAt || r.updatedAt,
      });
    }
    for (const c of pendingCorrections) {
      const emp = empMap.get(c.employeeId);
      combined.push({
        _id: c._id.toString(),
        employeeId: c.employeeId,
        employee: { fullName: emp?.name || c.employeeId, department: emp?.department || '' },
        date: c.date,
        requestType: 'correction',
        requestedCheckIn: c.correctionRequest?.requestedCheckIn,
        requestedCheckOut: c.correctionRequest?.requestedCheckOut,
        reason: c.correctionRequest?.reason || 'Time correction',
        createdAt: c.correctionRequest?.requestedAt || c.updatedAt,
      });
    }
    return combined;
  }

  const employee = await getActorEmployee(actor);
  const records = await Attendance.find({
    tenantId: actor.tenantId,
    employeeId: employee.employeeId,
    'correctionRequest.status': { $ne: 'none' },
  }).sort({ 'correctionRequest.requestedAt': -1 });

  return records;
};

export const getDailyBoard = async (
  actor: JWTPayload,
  query: { date?: string; department?: string }
) => {
  const targetDate = query.date || getLocalDateStr();
  const empFilter: any = {
    tenantId: actor.tenantId,
    status: { $ne: 'inactive' },
    role: { $ne: 'admin' },
  };
  if (query.department && query.department.trim() && query.department !== 'all') {
    empFilter.department = query.department.trim();
  }

  const [employees, attendances, leavesToday, holiday, settings] = await Promise.all([
    Employee.find(empFilter).sort({ employeeId: 1 }).lean(),
    Attendance.find({ tenantId: actor.tenantId, date: targetDate }).lean(),
    Leave.find({
      tenantId: actor.tenantId,
      status: 'approved',
      startDate: { $lte: targetDate },
      endDate: { $gte: targetDate },
    }).lean(),
    Holiday.findOne({ tenantId: actor.tenantId, date: targetDate }).lean(),
    Settings.findById(actor.tenantId).lean(),
  ]);

  const attMap = new Map(attendances.map((a) => [a.employeeId, a]));
  const leaveSet = new Set(leavesToday.map((l) => l.employeeId));
  const weekendDays = settings?.weekend || [0, 6];
  const dayOfWeek = new Date(`${targetDate}T00:00:00`).getDay();
  const isWeekend = weekendDays.includes(dayOfWeek);

  let present = 0;
  let late = 0;
  let halfDay = 0;
  let onLeave = 0;
  let absent = 0;

  const rows = employees.map((emp) => {
    const att = attMap.get(emp.employeeId);
    let status: 'Present' | 'Late' | 'Half-Day' | 'Absent' | 'On Leave' | 'Holiday' | 'Weekend' = 'Absent';

    if (att) {
      if (att.status === 'half-day') {
        status = 'Half-Day';
        halfDay++;
        present++;
      } else if (att.isLate || att.status === 'late') {
        status = 'Late';
        late++;
        present++;
      } else if (att.status === 'present') {
        status = 'Present';
        present++;
      } else {
        status = 'Absent';
        absent++;
      }
    } else if (leaveSet.has(emp.employeeId)) {
      status = 'On Leave';
      onLeave++;
    } else if (holiday) {
      status = 'Holiday';
    } else if (isWeekend) {
      status = 'Weekend';
    } else {
      status = 'Absent';
      absent++;
    }

    return {
      recordId: att?._id?.toString() || null,
      employeeId: emp.employeeId,
      fullName: emp.name,
      department: emp.department || 'Operations',
      designation: emp.designation || 'Staff',
      date: targetDate,
      status,
      checkIn: att?.checkIn ? new Date(att.checkIn).toISOString() : null,
      checkOut: att?.checkOut ? new Date(att.checkOut).toISOString() : null,
      lateMinutes: att?.lateMinutes || 0,
      workingHours: att?.workHours || 0,
      checkInLocation: att?.checkInLocation?.lat
        ? {
            lat: att.checkInLocation.lat,
            lng: att.checkInLocation.lng || 0,
            withinGeofence: true,
            distanceMeters: 0,
          }
        : null,
      checkInPhoto: att?.checkInPhoto || null,
      checkOutPhoto: att?.checkOutPhoto || null,
      isManualOverride: false,
      notes: att?.correctionRequest?.adminNotes || att?.clockOutResetRequest?.hrNotes || '',
    };
  });

  return {
    date: targetDate,
    isWeekend,
    holiday: holiday?.name || null,
    summary: {
      totalEmployees: employees.length,
      present,
      late,
      halfDay,
      onLeave,
      absent,
    },
    rows,
  };
};

export const resetClockOutByEmployeeOrId = async (
  actor: JWTPayload,
  input: {
    attendanceId?: string;
    employeeId?: string;
    date?: string;
    decision?: 'approved' | 'rejected';
    notes?: string;
  }
) => {
  if (input.attendanceId) {
    return resetEmployeeClockOut(actor, input.attendanceId, {
      decision: input.decision || 'approved',
      notes: input.notes,
    });
  }
  const targetDate = input.date || getLocalDateStr();
  if (!input.employeeId) {
    throw new AppError('Employee ID or Attendance ID is required to reset clock-out.', 422);
  }
  const att = await Attendance.findOne({
    tenantId: actor.tenantId,
    employeeId: input.employeeId.trim().toUpperCase(),
    date: targetDate,
  });
  if (!att) {
    throw new AppError(`No attendance record found for ${input.employeeId} on ${targetDate}.`, 404);
  }
  return resetEmployeeClockOut(actor, att._id.toString(), {
    decision: input.decision || 'approved',
    notes: input.notes,
  });
};

export const overrideAttendance = async (
  actor: JWTPayload,
  input: {
    employeeId: string;
    date: string;
    status: string;
    checkIn?: string | null;
    checkOut?: string | null;
    notes?: string;
  }
) => {
  if (actor.role !== 'admin' && actor.role !== 'hr') {
    throw new AppError('Only HR and Admin can override attendance.', 403);
  }
  const emp = await Employee.findOne({
    tenantId: actor.tenantId,
    employeeId: input.employeeId.trim().toUpperCase(),
  });
  if (!emp) throw new AppError('Employee not found.', 404);

  const normalizedStatusMap: Record<string, 'present' | 'late' | 'half-day' | 'absent'> = {
    present: 'present',
    Present: 'present',
    late: 'late',
    Late: 'late',
    'half-day': 'half-day',
    'Half-Day': 'half-day',
    absent: 'absent',
    Absent: 'absent',
  };
  const dbStatus = normalizedStatusMap[input.status] || 'present';
  const checkInDate = input.checkIn ? new Date(input.checkIn) : new Date(`${input.date}T09:00:00`);
  const checkOutDate = input.checkOut ? new Date(input.checkOut) : undefined;
  const workHours =
    checkOutDate && checkInDate
      ? Math.max(0, Math.round(((checkOutDate.getTime() - checkInDate.getTime()) / 3600000) * 10) / 10)
      : 0;

  const updateOp: any = {
    $set: {
      tenantId: actor.tenantId,
      employeeId: emp.employeeId,
      userId: emp.userId || actor.userId,
      date: input.date,
      checkIn: checkInDate,
      status: dbStatus,
      isLate: dbStatus === 'late',
      workHours,
    },
  };
  if (checkOutDate) {
    updateOp.$set.checkOut = checkOutDate;
  } else {
    updateOp.$unset = { checkOut: 1 };
  }

  const record = await Attendance.findOneAndUpdate(
    { tenantId: actor.tenantId, employeeId: emp.employeeId, date: input.date },
    updateOp,
    { upsert: true, new: true }
  );

  await recordAudit({
    actor,
    action: 'OVERRIDE_ATTENDANCE',
    entity: 'Attendance',
    entityId: record._id.toString(),
    after: {
      employeeId: emp.employeeId,
      date: input.date,
      status: dbStatus,
      notes: input.notes,
    },
  });

  return record;
};

export const listAllAttendance = async (
  query: {
    date?: string;
    department?: string;
    employeeId?: string;
    status?: string;
    onlyCorrections?: string;
    onlyClockOutResets?: string;
  },
  actor: JWTPayload
) => {
  const filter: any = { tenantId: actor.tenantId };
  if (query.date) filter.date = query.date;
  if (query.employeeId) filter.employeeId = query.employeeId.toUpperCase();
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.onlyCorrections === 'true') {
    filter['correctionRequest.status'] = 'pending';
  }
  if (query.onlyClockOutResets === 'true') {
    filter['clockOutResetRequest.status'] = 'pending';
  }

  const attendances = await Attendance.find(filter).sort({ date: -1, checkIn: -1 }).limit(300).lean();

  const employeeIds = [...new Set(attendances.map((a) => a.employeeId))];
  const employees = await Employee.find({
    tenantId: actor.tenantId,
    employeeId: { $in: employeeIds },
  }).lean();
  const empMap = new Map(employees.map((e) => [e.employeeId, e]));

  let enriched = attendances.map((a) => {
    const emp = empMap.get(a.employeeId);
    return {
      ...a,
      employeeName: emp?.name || a.employeeId,
      department: emp?.department || 'Operations',
      designation: emp?.designation || 'Staff',
    };
  });

  if (query.department && query.department !== 'all') {
    enriched = enriched.filter((e) => e.department.toLowerCase() === query.department?.toLowerCase());
  }

  return enriched;
};

/** Approve or Reject an employee attendance correction request (HR or Admin) */
export const reviewCorrection = async (
  actor: JWTPayload,
  attendanceId: string,
  decisionRaw: string,
  notes?: string
) => {
  if (actor.role !== 'admin' && actor.role !== 'hr') {
    throw new AppError('Only HR officers and Administrators can review attendance corrections.', 403);
  }

  const decision: 'approved' | 'rejected' =
    String(decisionRaw).toLowerCase() === 'rejected' ? 'rejected' : 'approved';

  const attendance = await Attendance.findOne({ _id: attendanceId, tenantId: actor.tenantId });
  if (!attendance) throw new AppError('Attendance record not found.', 404);

  // If this attendance record has a pending clock-out reset request, delegate to resetEmployeeClockOut
  if (attendance.clockOutResetRequest?.status === 'pending') {
    return resetEmployeeClockOut(actor, attendanceId, { decision, notes });
  }

  if (!attendance.correctionRequest || attendance.correctionRequest.status !== 'pending') {
    throw new AppError('No pending correction request found for this attendance record.', 400);
  }

  attendance.correctionRequest.status = decision;
  attendance.correctionRequest.reviewedBy = actor.userId as any;
  attendance.correctionRequest.reviewedAt = new Date();
  if (notes) attendance.correctionRequest.adminNotes = notes.trim();

  if (decision === 'approved') {
    if (attendance.correctionRequest.requestedCheckIn) {
      attendance.checkIn = new Date(attendance.correctionRequest.requestedCheckIn);
    }
    if (attendance.correctionRequest.requestedCheckOut) {
      attendance.checkOut = new Date(attendance.correctionRequest.requestedCheckOut);
    }

    // Recalculate work hours and late status
    const settings = await Settings.findById(actor.tenantId);
    const officeStart = settings?.officeStart || '09:00';
    const graceMinutes = settings?.graceMinutes ?? 15;
    const [startH, startM] = officeStart.split(':').map(Number);
    const startThreshold = new Date(attendance.checkIn);
    startThreshold.setHours(startH, startM + graceMinutes, 0, 0);

    const isLate = attendance.checkIn.getTime() > startThreshold.getTime();
    const lateMinutes = isLate ? Math.max(1, Math.round((attendance.checkIn.getTime() - startThreshold.getTime()) / 60000)) : 0;
    attendance.isLate = isLate;
    attendance.lateMinutes = lateMinutes;

    if (attendance.checkOut) {
      const durationMs = attendance.checkOut.getTime() - attendance.checkIn.getTime();
      const workHours = Math.round((durationMs / 3600000) * 10) / 10;
      attendance.workHours = workHours;
      const halfDayHours = settings?.halfDayHours ?? 5;
      attendance.status = workHours < halfDayHours ? 'half-day' : (isLate ? 'late' : 'present');
    } else {
      attendance.status = isLate ? 'late' : 'present';
    }
  }

  await attendance.save();

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'AttendanceCorrection',
    entityId: attendance._id.toString(),
    after: {
      status: decision,
      notes,
      checkIn: attendance.checkIn,
      checkOut: attendance.checkOut,
      attendanceStatus: attendance.status,
    },
  });

  // Notify employee
  try {
    const reviewer = await User.findById(actor.userId);
    const reviewerName = reviewer?.name || actor.email;
    await Notification.create({
      tenantId: actor.tenantId,
      type: 'notification',
      title: `Attendance Correction ${decision === 'approved' ? 'Approved ✓' : 'Rejected ✗'}`,
      message: `Your attendance correction for date ${attendance.date} was ${decision} by ${reviewerName}.${notes ? ` Note: "${notes.trim()}".` : ''}`,
      category: 'attendance',
      priority: decision === 'approved' ? 'normal' : 'high',
      recipientUserId: attendance.userId,
      senderName: reviewerName,
      link: '/attendance/calendar',
    });
  } catch (err) {
    console.error('[Notification Error - Attendance Correction]', err);
  }

  return attendance;
};
