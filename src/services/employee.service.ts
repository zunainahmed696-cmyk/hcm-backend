import { Employee } from '../models/Employee';
import { User } from '../models/User';
import { Department } from '../models/Org';
import { AppError } from '../utils/AppError';
import { JWTPayload } from '../types';
import { recordAudit } from './audit.service';
import { generateTempPassword } from './user.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateEmployeeInput {
  employeeId: string;
  name: string;
  fatherName: string;
  email: string;
  phone?: string;
  address?: string;
  department: string;
  designation: string;
  role?: 'admin' | 'hr' | 'employee';
  dateOfJoining: string;
  basicSalary: number;
  status?: 'active' | 'probation' | 'inactive';
  password?: string;
  mustChangePassword?: boolean;
}

export interface CSVValidationError {
  row: number;
  field: string;
  reason: string;
}

/** Validates single employee payload */
const validateEmployeeInput = (input: Partial<CreateEmployeeInput>): CreateEmployeeInput => {
  const employeeId = input.employeeId?.trim().toUpperCase();
  const name = input.name?.trim();
  const fatherName = input.fatherName?.trim();
  const email = input.email?.trim().toLowerCase();
  const department = input.department?.trim();
  const designation = input.designation?.trim();
  const dateOfJoining = input.dateOfJoining?.trim();
  const basicSalary = Number(input.basicSalary);

  if (!employeeId) throw new AppError('Employee ID is required (e.g., EMP-001).', 422);
  if (!name) throw new AppError('Employee Name is required.', 422);
  if (!fatherName) throw new AppError("Father's Name is required.", 422);
  if (!email || !EMAIL_RE.test(email)) throw new AppError('A valid corporate email is required.', 422);
  if (!department) throw new AppError('Department is required.', 422);
  if (!designation) throw new AppError('Designation is required.', 422);
  if (!dateOfJoining || !DATE_RE.test(dateOfJoining)) {
    throw new AppError('Date of Joining must be formatted as YYYY-MM-DD.', 422);
  }
  if (!Number.isFinite(basicSalary) || basicSalary <= 0) {
    throw new AppError('Basic Salary must be a positive number greater than 0.', 422);
  }

  // Password validation if custom password supplied
  if (input.password && input.password.trim().length < 6) {
    throw new AppError('Password must be at least 6 characters.', 422);
  }

  const sanitizedRole: 'hr' | 'employee' = input.role === 'hr' ? 'hr' : 'employee';

  return {
    employeeId,
    name,
    fatherName,
    email,
    phone: input.phone?.trim() || '',
    address: input.address?.trim() || '',
    department,
    designation,
    role: sanitizedRole,
    dateOfJoining,
    basicSalary,
    status: input.status || 'active',
    password: input.password?.trim(),
    mustChangePassword: input.mustChangePassword,
  };
};

/** Create a single employee and provision their user login (brief #06) */
export const createEmployee = async (input: Partial<CreateEmployeeInput>, actor: JWTPayload) => {
  const validated = validateEmployeeInput(input);

  // Check unique employeeId within this tenant
  const existingCode = await Employee.findOne({
    tenantId: actor.tenantId,
    employeeId: validated.employeeId,
  });
  if (existingCode) {
    throw new AppError(`Employee ID '${validated.employeeId}' is already assigned in your organization.`, 409);
  }

  // Check unique email in User collection
  const existingEmail = await User.findOne({ email: validated.email });
  if (existingEmail) {
    throw new AppError(`A user with email '${validated.email}' already exists.`, 409);
  }

  // Determine password: use custom password if provided, or generate temporary password
  const customPass = validated.password?.trim();
  const initialPassword = customPass || generateTempPassword();
  const forceChange = validated.mustChangePassword !== undefined ? validated.mustChangePassword : !customPass;

  const user = await User.create({
    tenantId: actor.tenantId,
    name: validated.name,
    email: validated.email,
    password: initialPassword,
    role: validated.role,
    mustChangePassword: forceChange,
    isActive: true,
  });

  // Check if department has a default shift configured
  const deptDoc = await Department.findOne({
    tenantId: actor.tenantId,
    name: validated.department,
  }).lean();

  // Create Employee document linked to User and Tenant
  const employee = await Employee.create({
    tenantId: actor.tenantId,
    employeeId: validated.employeeId,
    userId: user._id,
    name: validated.name,
    fatherName: validated.fatherName,
    email: validated.email,
    phone: validated.phone,
    address: validated.address,
    department: validated.department,
    designation: validated.designation,
    role: validated.role,
    dateOfJoining: validated.dateOfJoining,
    basicSalary: validated.basicSalary,
    status: validated.status,
    shiftName: (deptDoc as any)?.shiftName || 'Morning Shift',
    shiftStart: (deptDoc as any)?.shiftStart || '09:00',
    shiftEnd: (deptDoc as any)?.shiftEnd || '17:00',
    shiftGraceMinutes: (deptDoc as any)?.shiftGraceMinutes ?? 15,
  });

  await recordAudit({
    actor,
    action: 'CREATE',
    entity: 'Employee',
    entityId: employee._id.toString(),
    after: {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      basicSalary: employee.basicSalary,
    },
  });

  return {
    employee: enrichEmployee(employee.toObject()),
    password: initialPassword,
    tempPassword: initialPassword,
    mustChangePassword: forceChange,
    loginEmail: user.email,
  };
};

/** Parse standard RFC 4180 CSV string into object records */
export const parseCSVString = (csvText: string): Array<Record<string, string>> => {
  if (!csvText || !csvText.trim()) return [];

  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentLine += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\r' && nextChar === '\n') || char === '\n') {
      if (inQuotes) {
        currentLine += char;
      } else {
        if (currentLine.trim()) lines.push(currentLine);
        currentLine = '';
        if (char === '\r') i++;
      }
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) lines.push(currentLine);

  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const row: string[] = [];
    let field = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const nc = line[i + 1];
      if (c === '"') {
        if (inQ && nc === '"') {
          field += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (c === ',' && !inQ) {
        row.push(field.trim());
        field = '';
      } else {
        field += c;
      }
    }
    row.push(field.trim());
    return row;
  };

  const headers = parseRow(lines[0]).map((h) => h.replace(/^["']|["']$/g, '').trim());
  const results: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      rowObj[header] = values[idx] !== undefined ? values[idx].replace(/^["']|["']$/g, '').trim() : '';
    });
    if (Object.values(rowObj).some((v) => v.length > 0)) {
      results.push(rowObj);
    }
  }
  return results;
};

/** Process bulk CSV import with optional Dry-Run validation (brief #08) */
export const processBulkCSV = async (
  rows: Array<Record<string, any>>,
  isDryRun: boolean,
  actor: JWTPayload
) => {
  if (!rows || rows.length === 0) {
    throw new AppError('No employee records found in CSV file.', 400);
  }

  const errors: CSVValidationError[] = [];
  const validRows: CreateEmployeeInput[] = [];

  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  // Fetch existing DB IDs (scoped to tenant) and emails for collision detection
  const [existingEmployees, existingUsers] = await Promise.all([
    Employee.find({ tenantId: actor.tenantId }, 'employeeId email').lean(),
    User.find({}, 'email').lean(),
  ]);
  const dbIds = new Set(existingEmployees.map((e) => e.employeeId));
  const dbEmails = new Set([
    ...existingEmployees.map((e) => e.email.toLowerCase()),
    ...existingUsers.map((u) => u.email.toLowerCase()),
  ]);

  // Fetch valid departments if any are registered for this tenant
  const registeredDepts = await Department.find({ tenantId: actor.tenantId }, 'name').lean();
  const validDeptNames = new Set(registeredDepts.map((d) => d.name.toLowerCase()));

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const employeeId = String(row.employeeId || row.id || row.code || '').trim().toUpperCase();
    const name = String(row.name || row.fullName || '').trim();
    const fatherName = String(row.fatherName || row.father_name || row['father name'] || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const phone = String(row.phone || row.mobile || '').trim();
    const address = String(row.address || '').trim();
    const department = String(row.department || row.dept || '').trim();
    const designation = String(row.designation || row.title || '').trim();
    const dateOfJoining = String(row.dateOfJoining || row.joiningDate || row.doj || '').trim();
    const basicSalary = Number(row.basicSalary || row.salary || row.basic || 0);

    // Validate fields
    if (!employeeId) {
      errors.push({ row: rowNum, field: 'employeeId', reason: 'Missing employee ID' });
    } else if (seenIds.has(employeeId) || dbIds.has(employeeId)) {
      errors.push({ row: rowNum, field: 'employeeId', reason: `Employee ID '${employeeId}' is a duplicate` });
    } else {
      seenIds.add(employeeId);
    }

    if (!name) {
      errors.push({ row: rowNum, field: 'name', reason: 'Missing employee name' });
    }

    if (!fatherName) {
      errors.push({ row: rowNum, field: 'fatherName', reason: "Missing father's name" });
    }

    if (!email || !EMAIL_RE.test(email)) {
      errors.push({ row: rowNum, field: 'email', reason: 'Invalid or missing email address' });
    } else if (seenEmails.has(email) || dbEmails.has(email)) {
      errors.push({ row: rowNum, field: 'email', reason: `Email '${email}' is already registered` });
    } else {
      seenEmails.add(email);
    }

    if (!department) {
      errors.push({ row: rowNum, field: 'department', reason: 'Missing department' });
    } else if (validDeptNames.size > 0 && !validDeptNames.has(department.toLowerCase())) {
      errors.push({
        row: rowNum,
        field: 'department',
        reason: `Department '${department}' is not a recognized department in organization setup`,
      });
    }

    if (!designation) {
      errors.push({ row: rowNum, field: 'designation', reason: 'Missing designation' });
    }

    if (!dateOfJoining || !DATE_RE.test(dateOfJoining)) {
      errors.push({ row: rowNum, field: 'dateOfJoining', reason: 'Date of joining must be YYYY-MM-DD format' });
    }

    if (!Number.isFinite(basicSalary) || basicSalary <= 0) {
      errors.push({ row: rowNum, field: 'basicSalary', reason: 'Basic salary must be greater than 0' });
    }

    const password = String(row.password || '').trim();
    if (password && password.length < 6) {
      errors.push({ row: rowNum, field: 'password', reason: 'Password must be at least 6 characters' });
    }

    const rowRoleRaw = String(row.role || '').trim().toLowerCase();
    const resolvedRole: 'hr' | 'employee' =
      rowRoleRaw === 'hr' || department.toLowerCase() === 'human resources' ? 'hr' : 'employee';

    // If this row has no errors, prepare it for insertion
    const rowErrors = errors.filter((e) => e.row === rowNum);
    if (rowErrors.length === 0) {
      validRows.push({
        employeeId,
        name,
        fatherName,
        email,
        phone,
        address,
        department,
        designation,
        role: resolvedRole,
        dateOfJoining,
        basicSalary,
        status: 'active',
        password: password || undefined,
      });
    }
  });

  // If this is a dry run, return audit and validation summary
  if (isDryRun) {
    return {
      dryRun: true,
      totalRows: rows.length,
      validCount: validRows.length,
      invalidCount: rows.length - validRows.length,
      canCommit: errors.length === 0,
      errors,
      preview: validRows.slice(0, 5),
    };
  }

  // If not dry run and errors exist, reject import to maintain data integrity
  if (errors.length > 0) {
    throw new AppError(
      `Cannot import CSV. ${errors.length} validation issues found. Please fix them or run dry-run first.`,
      422
    );
  }

  // Commit insertion
  const createdResults = [];
  for (const item of validRows) {
    const customPass = item.password?.trim();
    const finalPass = customPass || generateTempPassword();
    const forceChange = !customPass;

    const user = await User.create({
      tenantId: actor.tenantId,
      name: item.name,
      email: item.email,
      password: finalPass,
      role: item.role || 'employee',
      mustChangePassword: forceChange,
      isActive: true,
    });

    const employee = await Employee.create({
      tenantId: actor.tenantId,
      employeeId: item.employeeId,
      userId: user._id,
      name: item.name,
      fatherName: item.fatherName,
      email: item.email,
      phone: item.phone,
      address: item.address,
      department: item.department,
      designation: item.designation,
      role: item.role || 'employee',
      dateOfJoining: item.dateOfJoining,
      basicSalary: item.basicSalary,
      status: item.status || 'active',
    });

    createdResults.push({
      employeeId: employee.employeeId,
      name: employee.name,
      email: employee.email,
      tempPassword: finalPass,
      password: finalPass,
      mustChangePassword: forceChange,
    });
  }

  await recordAudit({
    actor,
    action: 'BULK_IMPORT',
    entity: 'Employee',
    after: { importedCount: createdResults.length },
  });

  return {
    dryRun: false,
    importedCount: createdResults.length,
    credentials: createdResults,
  };
};

export const enrichEmployee = (emp: any) => {
  if (!emp) return emp;
  const basic = Number(emp.basicSalary || 0);
  const hra = Math.round(basic * 0.4);
  const medical = Math.round(basic * 0.1);
  return {
    ...emp,
    id: emp._id?.toString() || emp.id,
    grossSalary: Math.round(basic * 1.5),
    allowances: {
      hra,
      medical,
      total: hra + medical,
    },
  };
};

/** List employees with server-side search, filters & pagination scoped to tenant (brief #07) */
export const listEmployees = async (
  query: {
    search?: string;
    department?: string;
    designation?: string;
    status?: string;
    page?: string;
    limit?: string;
  },
  actor: JWTPayload
) => {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {
    tenantId: actor.tenantId,
    role: { $ne: 'admin' },
  };

  if (query.department) filter.department = query.department;
  if (query.designation) filter.designation = query.designation;
  if (query.status) filter.status = query.status;

  if (query.search?.trim()) {
    const s = query.search.trim();
    const regex = new RegExp(s, 'i');
    filter.$or = [
      { name: regex },
      { fatherName: regex },
      { employeeId: regex },
      { email: regex },
      { phone: regex },
    ];
  }

  const [rawEmployees, total] = await Promise.all([
    Employee.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Employee.countDocuments(filter),
  ]);

  return {
    employees: rawEmployees.map(enrichEmployee),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

/** Get Employee 360 profile scoped to tenant */
export const getEmployeeById = async (id: string, actor: JWTPayload) => {
  const employee = await Employee.findOne({ _id: id, tenantId: actor.tenantId }).lean();
  if (!employee) throw new AppError('Employee not found.', 404);

  // Scoping check: an employee can only view their own profile
  if (actor.role === 'employee' && employee.userId.toString() !== actor.userId) {
    throw new AppError('Access denied. You can only view your own employee record.', 403);
  }

  return enrichEmployee(employee);
};

/** Update employee record scoped to tenant */
export const updateEmployee = async (
  id: string,
  updateData: Partial<CreateEmployeeInput>,
  actor: JWTPayload
) => {
  const employee = await Employee.findOne({ _id: id, tenantId: actor.tenantId });
  if (!employee) throw new AppError('Employee not found.', 404);

  const before = employee.toObject();

  // If employee role, only allow editing phone and address (brief rule)
  if (actor.role === 'employee') {
    if (employee.userId.toString() !== actor.userId) {
      throw new AppError('Access denied.', 403);
    }
    if (updateData.phone !== undefined) employee.phone = updateData.phone.trim();
    if (updateData.address !== undefined) employee.address = updateData.address.trim();
  } else {
    // Admin or HR
    if (updateData.name) employee.name = updateData.name.trim();
    if (updateData.fatherName) employee.fatherName = updateData.fatherName.trim();
    if (updateData.phone !== undefined) employee.phone = updateData.phone.trim();
    if (updateData.address !== undefined) employee.address = updateData.address.trim();
    if (updateData.department) employee.department = updateData.department.trim();
    if (updateData.designation) employee.designation = updateData.designation.trim();
    if (updateData.status) employee.status = updateData.status;
    if (updateData.role && (actor.role === 'admin' || actor.role === 'hr')) {
      const targetRole: 'hr' | 'employee' = updateData.role === 'hr' ? 'hr' : 'employee';
      employee.role = targetRole;
      await User.findByIdAndUpdate(employee.userId, { role: targetRole });
    }
    if (updateData.basicSalary && Number(updateData.basicSalary) > 0) {
      employee.basicSalary = Number(updateData.basicSalary);
    }
  }

  await employee.save();

  await recordAudit({
    actor,
    action: 'UPDATE',
    entity: 'Employee',
    entityId: id,
    before,
    after: employee.toObject(),
  });

  return enrichEmployee(employee.toObject());
};

/** Export all employees for the tenant as CSV string (brief #08) */
export const exportEmployeesCSV = async (actor: JWTPayload) => {
  const employees = await Employee.find({
    tenantId: actor.tenantId,
    role: { $ne: 'admin' },
  })
    .sort({ employeeId: 1 })
    .lean({ virtuals: true });

  const headers = [
    'employeeId',
    'name',
    'fatherName',
    'email',
    'phone',
    'department',
    'designation',
    'dateOfJoining',
    'basicSalary',
    'grossSalary',
    'status',
  ];

  const escapeCSV = (val: any) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = employees.map((e) => {
    const gross = (e as any).grossSalary ?? Math.round(e.basicSalary * 1.5);
    return [
      e.employeeId,
      e.name,
      e.fatherName,
      e.email,
      e.phone,
      e.department,
      e.designation,
      e.dateOfJoining,
      e.basicSalary,
      gross,
      e.status,
    ]
      .map(escapeCSV)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
};

/** Reset employee password (admin / hr) scoped to tenant */
export const resetEmployeePassword = async (
  employeeIdOrDocId: string,
  newPassword?: string,
  forceChange?: boolean,
  actor?: JWTPayload
) => {
  const isMongoId = /^[0-9a-fA-F]{24}$/.test(employeeIdOrDocId);
  const filter: Record<string, any> = {
    $or: [
      { employeeId: employeeIdOrDocId.toUpperCase() },
      ...(isMongoId ? [{ _id: employeeIdOrDocId }] : []),
    ],
  };
  if (actor?.tenantId) {
    filter.tenantId = actor.tenantId;
  }

  const employee = await Employee.findOne(filter);
  if (!employee) throw new AppError('Employee not found.', 404);

  const user = await User.findById(employee.userId);
  if (!user) throw new AppError('Linked user login account not found.', 404);

  let passwordToSet = newPassword?.trim();
  let mustChange = forceChange;

  if (passwordToSet) {
    if (passwordToSet.length < 6) {
      throw new AppError('Password must be at least 6 characters.', 422);
    }
    if (mustChange === undefined) mustChange = false;
  } else {
    passwordToSet = generateTempPassword();
    mustChange = true;
  }

  user.password = passwordToSet;
  user.mustChangePassword = mustChange;
  await user.save();

  if (actor) {
    await recordAudit({
      actor,
      action: 'UPDATE',
      entity: 'User',
      entityId: user._id.toString(),
      after: { email: user.email, resetPassword: true, mustChangePassword: mustChange },
    });
  }

  return {
    employeeId: employee.employeeId,
    name: employee.name,
    email: user.email,
    password: passwordToSet,
    tempPassword: passwordToSet,
    mustChangePassword: mustChange,
  };
};
