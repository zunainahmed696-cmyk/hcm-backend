import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as empService from '../services/employee.service';

type Handler = (req: AuthRequest, res: Response) => Promise<{ status?: number; body?: object }>;

const wrap = (fn: Handler) => async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await fn(req, res);
    if (result) {
      const { status = 200, body } = result;
      res.status(status).json({ success: true, ...body });
    }
  } catch (error) {
    next(error);
  }
};

/** List employees with search, department/status filter and pagination */
export const listEmployees = wrap(async (req) => {
  const result = await empService.listEmployees(req.query as any);
  return { body: result };
});

/** Get single employee profile */
export const getEmployeeById = wrap(async (req) => {
  const employee = await empService.getEmployeeById(req.params.id, req.user!);
  return { body: { employee } };
});

/** Create a single employee and generate temporary credentials */
export const createEmployee = wrap(async (req) => {
  const result = await empService.createEmployee(req.body, req.user!);
  return { status: 201, body: result };
});

/** Bulk import employees via CSV text or parsed rows (supports ?dryRun=true) */
export const bulkImport = wrap(async (req) => {
  const isDryRun = req.query.dryRun === 'true' || req.body.dryRun === true;
  let rows = req.body.rows;

  if ((!rows || !Array.isArray(rows) || rows.length === 0) && req.body.csvText) {
    rows = empService.parseCSVString(req.body.csvText);
  }

  const result = await empService.processBulkCSV(rows || [], isDryRun, req.user!);
  return { status: isDryRun ? 200 : 201, body: result };
});

/** Update employee record */
export const updateEmployee = wrap(async (req) => {
  const employee = await empService.updateEmployee(req.params.id, req.body, req.user!);
  return { body: { employee } };
});

/** Reset employee password */
export const resetPassword = wrap(async (req) => {
  const result = await empService.resetEmployeePassword(
    req.params.id,
    req.body.password,
    req.body.mustChangePassword,
    req.user!
  );
  return { body: result };
});

/** Export all employee records as downloadable CSV */
export const exportCSV = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const csv = await empService.exportEmployeesCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

/** Get sample CSV template with exact column headers and dummy data */
export const getSampleCSV = async (_req: AuthRequest, res: Response): Promise<void> => {
  const sampleHeaders = 'employeeId,name,fatherName,email,phone,address,department,designation,role,dateOfJoining,basicSalary';
  const sampleRows = [
    'EMP-101,Aisha Khan,Tariq Khan,aisha.khan@acme.com,03001234567,Shahrah-e-Faisal Karachi,Engineering,Senior Software Engineer,employee,2024-01-15,120000',
    'EMP-102,Bilal Ahmed,Farooq Ahmed,bilal.ahmed@acme.com,03219876543,Gulshan-e-Iqbal Karachi,Operations,Operations Specialist,employee,2024-02-01,95000',
    'EMP-103,Zainab Fatima,Muhammad Imran,zainab.fatima@acme.com,03335557788,DHA Phase 5 Karachi,Human Resources,HR Executive,hr,2024-03-10,80000',
  ];
  const sampleContent = [sampleHeaders, ...sampleRows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="employee_import_template.csv"');
  res.send(sampleContent);
};
