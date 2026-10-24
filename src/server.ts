import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import authRoutes from './routes/auth.routes';
import orgRoutes from './routes/org.routes';
import employeeRoutes from './routes/employee.routes';
import attendanceRoutes from './routes/attendance.routes';
import leaveRoutes from './routes/leave.routes';
import notificationRoutes from './routes/notification.routes';
import profileRoutes from './routes/profile.routes';
import payrollRoutes from './routes/payroll.routes';
import auditRoutes from './routes/audit.routes';
import aiRoutes from './routes/ai.routes';
import { errorHandler } from './middlewares/error.middleware';
import { bootstrapFromEnv } from './services/auth.service';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Middlewares
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.options('*', cors({ origin: true, credentials: true }));

// Explicit CORS headers and preflight handler
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure database connection for serverless executions
app.use(async (_req: Request, _res: Response, next) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('Database connection error in middleware:', err);
  }
  next();
});

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    message: 'Backend API is running smoothly',
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/ai', aiRoutes);


// 404 Handler for undefined API routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `API Route ${req.originalUrl} not found`,
  });
});

// Centralized Error Handler
app.use(errorHandler);


// Start Server (only bind port if not running in serverless environment)
const startServer = async () => {
  try {
    await connectDB();
    await bootstrapFromEnv(); // no-op unless ADMIN_EMAIL / ADMIN_PASSWORD are set and DB is empty

    app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(`🚀 Server listening on http://localhost:${PORT}`);
      console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`===============================================`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
  }
};

if (process.env.VERCEL !== '1') {
  startServer();
} else {
  connectDB().catch(console.error);
}

export default app;
