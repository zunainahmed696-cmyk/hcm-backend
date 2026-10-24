import mongoose from 'mongoose';

export const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState >= 1) {
    return;
  }
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hackathon_db';
    const conn = await mongoose.connect(mongoUri);
    console.log(`[MongoDB] Connected successfully to: ${conn.connection.host}/${conn.connection.name}`);
  } catch (error) {
    console.error('[MongoDB] Connection error:', error);
    if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
      process.exit(1);
    }
  }
};
