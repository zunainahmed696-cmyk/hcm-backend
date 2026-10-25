import mongoose from 'mongoose';
import dns from 'dns';

// Ensure reliable SRV DNS resolution for mongodb+srv:// URIs on local networks
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if DNS servers cannot be overridden in restricted environments
}

let indexesSynced = false;

const dropLegacyGlobalIndexes = async () => {
  if (indexesSynced || !mongoose.connection.db) return;
  indexesSynced = true;

  const legacyIndexes: Array<{ collection: string; indexName: string }> = [
    { collection: 'departments', indexName: 'name_1' },
    { collection: 'designations', indexName: 'name_1' },
    { collection: 'leavetypes', indexName: 'name_1' },
    { collection: 'holidays', indexName: 'date_1' },
    { collection: 'employees', indexName: 'employeeId_1' },
    { collection: 'attendances', indexName: 'employeeId_1_date_1' },
    { collection: 'payslips', indexName: 'employeeId_1_month_1' },
  ];

  for (const { collection, indexName } of legacyIndexes) {
    try {
      await mongoose.connection.db.collection(collection).dropIndex(indexName);
      console.log(`[MongoDB] Dropped legacy non-tenant index ${collection}.${indexName}`);
    } catch {
      // Index already dropped or collection does not exist yet
    }
  }
  try {
    // Ensure Company Owners (role: 'admin') are never stored in the employees collection
    await mongoose.connection.db.collection('employees').deleteMany({ role: 'admin' });
  } catch {
    // Ignore if collection does not exist yet
  }
};

export const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState >= 1) {
    return;
  }
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hackathon_db';
    const conn = await mongoose.connect(mongoUri);
    console.log(`[MongoDB] Connected successfully to: ${conn.connection.host}/${conn.connection.name}`);
    await dropLegacyGlobalIndexes();
  } catch (error) {
    console.error('[MongoDB] Connection error:', error);
    if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
      process.exit(1);
    }
  }
};
