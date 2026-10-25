import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { User } from '../models/User';
import Employee from '../models/Employee';
import { Settings } from '../models/Settings';
import { Department, Designation, LeaveType } from '../models/Org';

const seedAccounts = async () => {
  try {
    await connectDB();

    // 1. Ensure Company Settings exist
    let settings = await Settings.findOne({ companyName: 'Acme Corporation' }) || await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({
        companyName: 'Acme Corporation',
        officeStart: '09:00',
        graceMinutes: 15,
        halfDayHours: 5,
        weekend: [0, 6], // Sunday, Saturday
        office: {
          lat: 24.8607,
          lng: 67.0011,
          radiusMeters: 150,
        },
      });
      console.log('[Seed] Created default company settings: Acme Corporation');
    } else {
      console.log('[Seed] Company settings already exist:', settings.companyName);
    }

    const tenantId = settings._id;

    // 2. Ensure basic departments & designations exist for testing
    const depts = ['Engineering', 'Human Resources', 'Operations', 'Finance'];
    for (const d of depts) {
      await Department.findOneAndUpdate({ tenantId, name: d }, { tenantId, name: d }, { upsert: true });
    }

    const designations = ['Senior Engineer', 'HR Officer', 'Operations Lead', 'Financial Analyst'];
    for (const des of designations) {
      await Designation.findOneAndUpdate({ tenantId, name: des }, { tenantId, name: des }, { upsert: true });
    }

    const leaveTypes = [
      { name: 'Annual', annualQuota: 14, unlimited: false, isPaid: true },
      { name: 'Sick', annualQuota: 8, unlimited: false, isPaid: true },
      { name: 'Casual', annualQuota: 10, unlimited: false, isPaid: true },
      { name: 'Unpaid', annualQuota: 0, unlimited: true, isPaid: false },
    ];
    for (const lt of leaveTypes) {
      await LeaveType.findOneAndUpdate({ tenantId, name: lt.name }, { tenantId, ...lt }, { upsert: true });
    }

    // 3. Define the three test credentials
    const accounts = [
      {
        name: 'Alexander Vance (Owner / Admin)',
        email: 'admin@acme.com',
        password: 'Password123!',
        role: 'admin' as const,
        isActive: true,
        mustChangePassword: false,
      },
      {
        name: 'Sarah Jenkins (HR Officer)',
        email: 'hr@acme.com',
        password: 'Password123!',
        role: 'hr' as const,
        isActive: true,
        mustChangePassword: false,
      },
      {
        name: 'David Miller (Employee)',
        email: 'employee@acme.com',
        password: 'Password123!',
        role: 'employee' as const,
        isActive: true,
        mustChangePassword: false,
      },
    ];

    console.log('[Seed] Provisioning test role accounts...');
    for (const acc of accounts) {
      await User.deleteOne({ email: acc.email });
      const createdUser = await User.create({
        ...acc,
        tenantId,
        isActive: true,
      });

      // Also ensure Employee profile exists and is active
      const codeSuffix = acc.role.toUpperCase();
      await Employee.deleteOne({ email: acc.email });
      await Employee.create({
        tenantId,
        employeeId: `EMP-${codeSuffix}-01`,
        userId: createdUser._id,
        name: acc.name,
        fatherName: 'Senior Official',
        email: acc.email,
        phone: '+92 300 1234567',
        address: 'Karachi, Pakistan',
        department: acc.role === 'admin' ? 'Operations' : acc.role === 'hr' ? 'Human Resources' : 'Engineering',
        designation: acc.role === 'admin' ? 'Administrator' : acc.role === 'hr' ? 'HR Officer' : 'Senior Engineer',
        role: acc.role,
        dateOfJoining: '2026-01-01',
        basicSalary: acc.role === 'employee' ? 100000 : 150000,
        status: 'active',
      });

      console.log(`[Seed] Created ${acc.role.toUpperCase()}: ${acc.email} / ${acc.password}`);
    }

    console.log('\n===============================================');
    console.log('SUCCESS! Credentials ready for testing:');
    console.log('1. Owner / Admin: admin@acme.com    / Password123!');
    console.log('2. HR Officer:    hr@acme.com       / Password123!');
    console.log('3. Employee:      employee@acme.com / Password123!');
    console.log('===============================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[Seed Error]:', err);
    process.exit(1);
  }
};

seedAccounts();
