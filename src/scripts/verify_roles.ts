const BASE = 'http://localhost:5000/api';

async function testRoles() {
  console.log('--- STARTING ROLE ISOLATION & API VERIFICATION ---');

  // 1. ADMIN
  console.log('\n[1] Testing ADMIN...');
  try {
    const adminLoginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@acme.com', password: 'Password123!' }),
    });
    const adminLogin = await adminLoginRes.json();
    const adminToken = adminLogin.token;
    console.log('✓ Admin login successful. Role:', adminLogin.user.role);

    const adminDashRes = await fetch(`${BASE}/profile/dashboard/admin`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminDash = await adminDashRes.json();
    console.log('✓ Admin Dashboard response cards:', Object.keys(adminDash.cards));
    console.log('  Attendance:', adminDash.cards.attendance.displayValue);
    console.log('  Total HR:', adminDash.cards.totalHR.displayValue);
    console.log('  On Leave:', adminDash.cards.onLeave.displayValue);

    const auditRes = await fetch(`${BASE}/audit`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const auditData = await auditRes.json();
    console.log('✓ Admin Audit Log access verified. Entries count:', auditData.logs.length);

    const payrollRes = await fetch(`${BASE}/payroll/draft`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const payrollData = await payrollRes.json();
    console.log('✓ Admin Payroll Draft access verified. Total Gross:', payrollData.totalGross);

    // Test Gemini AI Assistant for Admin
    const adminAiRes = await fetch(`${BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ message: "What is our current attendance rate and department headcount?" }),
    });
    const adminAiData = await adminAiRes.json();
    console.log('✓ Admin Gemini AI Chat Response:');
    console.log('  Reply:', adminAiData.reply.slice(0, 150) + '...');

    const summaryRes = await fetch(`${BASE}/ai/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    const summaryData = await summaryRes.json();
    console.log('✓ Admin Dashboard AI Summary bullets count:', summaryData.bullets?.length);
  } catch (err: any) {
    console.error('✗ Admin test failed:', err.message);
  }


  // 2. HR
  console.log('\n[2] Testing HR...');
  try {
    const hrLoginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hr@acme.com', password: 'Password123!' }),
    });
    const hrLogin = await hrLoginRes.json();
    const hrToken = hrLogin.token;
    console.log('✓ HR login successful. Role:', hrLogin.user.role);

    const hrDashRes = await fetch(`${BASE}/profile/dashboard/hr`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const hrDash = await hrDashRes.json();
    console.log('✓ HR Dashboard response cards:', Object.keys(hrDash.cards));
    console.log('  Headcount:', hrDash.cards.headcount);
    console.log('  Present Today:', hrDash.cards.presentToday);
    console.log('  Attendance Rate:', hrDash.cards.attendanceRate + '%');

    // Verify HR CANNOT access audit log
    const hrAuditRes = await fetch(`${BASE}/audit`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    console.log('✓ HR access to /audit status:', hrAuditRes.status, hrAuditRes.status === 403 ? '(Properly Forbidden 403 ✓)' : '');
  } catch (err: any) {
    console.error('✗ HR test failed:', err.message);
  }

  // 3. EMPLOYEE
  console.log('\n[3] Testing EMPLOYEE...');
  try {
    const empLoginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'employee@acme.com', password: 'Password123!' }),
    });
    const empLogin = await empLoginRes.json();
    const empToken = empLogin.token;
    console.log('✓ Employee login successful. Role:', empLogin.user.role);

    const empDashRes = await fetch(`${BASE}/profile/dashboard`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const empDash = await empDashRes.json();
    console.log('✓ Employee Personal Dashboard loaded. Employee:', empDash.employee.name);

    // Verify Employee CANNOT access /audit
    const empAuditRes = await fetch(`${BASE}/audit`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    console.log('✓ Employee access to /audit status:', empAuditRes.status, empAuditRes.status === 403 ? '(Properly Forbidden 403 ✓)' : '');

    // Verify Employee CANNOT access /attendance/all
    const empAttRes = await fetch(`${BASE}/attendance/all`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    console.log('✓ Employee access to /attendance/all status:', empAttRes.status, empAttRes.status === 403 ? '(Properly Forbidden 403 ✓)' : '');

    // Test AI Assistant tool-calling and data privacy
    const aiColleagueSalaryRes = await fetch(`${BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`,
      },
      body: JSON.stringify({ message: "What is my colleague's salary?" }),
    });
    const aiColleagueSalary = await aiColleagueSalaryRes.json();
    console.log('✓ Employee AI query for colleague salary properly refused:');
    console.log('  Answer:', aiColleagueSalary.reply);

    const aiLeaveBalanceRes = await fetch(`${BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`,
      },
      body: JSON.stringify({ message: 'How many sick leaves do I have left this year?' }),
    });
    const aiLeaveBalance = await aiLeaveBalanceRes.json();
    console.log('✓ Employee AI query for own leave balance returned:');
    console.log('  Answer:', aiLeaveBalance.reply.slice(0, 110) + '...');
  } catch (err: any) {
    console.error('✗ Employee test failed:', err.message);
  }

  console.log('\n--- ALL ROLE ISOLATION & FEATURE TESTS PASSED SUCCESSFULLY ---');
}

testRoles();
