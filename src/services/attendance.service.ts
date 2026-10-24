import Attendance, { IAttendanceDocument } from '../models/Attendance';
import Employee from '../models/Employee';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { Settings } from '../models/Settings';
import { Holiday } from '../models/Org';
import { recordAudit } from './audit.service';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';

export const getActorEmployee = async (actor: JWTPayload) => {
  let employee = await Employee.findOne({ userId: actor.userId });
  if (!employee) {
    employee = await Employee.findOne({ email: actor.email });
    if (employee) {
      if (!employee.userId) {
        employee.userId = actor.userId as any;
        await employee.save();
      }
    } else {
      const userDoc = await User.findById(actor.userId);
      const codeSuffix = String(actor.userId).slice(-4).toUpperCase();
      employee = await Employee.create({
        employeeId: `EMP-${codeSuffix}`,
        userId: actor.userId as any,
        name: userDoc?.name || actor.email.split('@')[0],
        fatherName: 'Not Specified',
        email: actor.email,
        phone: '',
        address: '',
        department: 'Engineering',
        designation:
          actor.role === 'admin'
            ? 'Administrator'
            : actor.role === 'hr'
            ? 'HR Officer'
            : 'Software Engineer',
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

  // Check if attendance already exists for today (Brief #09 -> 409 Conflict)
  const existing = await Attendance.findOne({ employeeId: employee.employeeId, date: todayStr });
  if (existing) {
    throw new AppError('You have already checked in today.', 409);
  }

  const settings = await Settings.findOne();
  const officeStart = settings?.officeStart || '09:00';
  const graceMinutes = settings?.graceMinutes ?? 15;

  const [startH, startM] = officeStart.split(':').map(Number);
  const startThreshold = new Date(now);
  startThreshold.setHours(startH, startM + graceMinutes, 0, 0);

  const isLate = now.getTime() > startThreshold.getTime();
  const lateMinutes = isLate ? Math.max(1, Math.round((now.getTime() - startThreshold.getTime()) / 60000)) : 0;
  const status = isLate ? 'late' : 'present';

  const attendance = await Attendance.create({
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

  // Notify Owner (Admin) and HR officers of employee clock-in
  try {
    const supervisors = await User.find({ role: { $in: ['admin', 'hr'] }, isActive: true });
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusDesc = isLate ? `Late by ${lateMinutes}m` : 'On Time (Present)';
    await Promise.all(
      supervisors.map((s) =>
        Notification.create({
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

  const attendance = await Attendance.findOne({ employeeId: employee.employeeId, date: todayStr });
  if (!attendance) {
    throw new AppError('No check-in record found for today. Please check in first.', 404);
  }
  if (attendance.checkOut) {
    throw new AppError('You have already checked out today.', 400);
  }

  const settings = await Settings.findOne();
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

  // Notify Owner (Admin) and HR officers of employee clock-out
  try {
    const supervisors = await User.find({ role: { $in: ['admin', 'hr'] }, isActive: true });
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await Promise.all(
      supervisors.map((s) =>
        Notification.create({
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

export const getTodayStatus = async (actor: JWTPayload) => {
  const employee = await getActorEmployee(actor);
  const todayStr = getLocalDateStr();
  const attendance = await Attendance.findOne({ employeeId: employee.employeeId, date: todayStr });
  const settings = await Settings.findOne();

  return {
    employee: {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      designation: employee.designation,
    },
    attendance,
    settings: {
      officeStart: settings?.officeStart || '09:00',
      graceMinutes: settings?.graceMinutes ?? 15,
      halfDayHours: settings?.halfDayHours ?? 5,
      weekend: settings?.weekend || [0, 6],
      office: settings?.office,
    },
    serverTime: new Date().toISOString(),
  };
};

export const getMyCalendar = async (actor: JWTPayload, monthQuery?: string) => {
  const employee = await getActorEmployee(actor);
  const month = monthQuery || new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthRegex = new RegExp(`^${month}`);

  const [attendances, holidays, settings] = await Promise.all([
    Attendance.find({ employeeId: employee.employeeId, date: monthRegex }).sort({ date: 1 }),
    Holiday.find({ date: monthRegex }),
    Settings.findOne(),
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

  let attendance = await Attendance.findOne({ employeeId: employee.employeeId, date: input.date });
  if (!attendance) {
    // Create placeholder attendance for missing record
    attendance = new Attendance({
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

export const getMyCorrectionRequests = async (actor: JWTPayload) => {
  const employee = await getActorEmployee(actor);
  const records = await Attendance.find({
    employeeId: employee.employeeId,
    'correctionRequest.status': { $ne: 'none' },
  }).sort({ 'correctionRequest.requestedAt': -1 });

  return records;
};

export const listAllAttendance = async (query: {
  date?: string;
  department?: string;
  employeeId?: string;
  status?: string;
  onlyCorrections?: string;
}) => {
  const filter: any = {};
  if (query.date) filter.date = query.date;
  if (query.employeeId) filter.employeeId = query.employeeId.toUpperCase();
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.onlyCorrections === 'true') {
    filter['correctionRequest.status'] = 'pending';
  }

  const attendances = await Attendance.find(filter).sort({ date: -1, checkIn: -1 }).limit(300).lean();

  const employeeIds = [...new Set(attendances.map((a) => a.employeeId))];
  const employees = await Employee.find({ employeeId: { $in: employeeIds } }).lean();
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
  decision: 'approved' | 'rejected',
  notes?: string
) => {
  if (actor.role !== 'admin' && actor.role !== 'hr') {
    throw new AppError('Only HR officers and Administrators can review attendance corrections.', 403);
  }

  const attendance = await Attendance.findById(attendanceId);
  if (!attendance) throw new AppError('Attendance record not found.', 404);
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
    const settings = await Settings.findOne();
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

