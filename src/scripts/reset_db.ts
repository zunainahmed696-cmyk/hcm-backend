import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

const resetDatabase = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not set in environment variables');
    }

    console.log('[Reset] Connecting to MongoDB Atlas...');
    await mongoose.connect(mongoUri);
    console.log('[Reset] Connected successfully.');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection is not initialized');
    }

    const collections = await db.listCollections().toArray();
    console.log(`[Reset] Found ${collections.length} collections to clean:`);

    for (const coll of collections) {
      const collectionName = coll.name;
      // Do not drop system collections
      if (collectionName.startsWith('system.')) continue;

      const count = await db.collection(collectionName).countDocuments();
      await db.collection(collectionName).deleteMany({});
      console.log(`[Reset] Cleared collection '${collectionName}' (${count} documents deleted).`);
    }

    console.log('\n===============================================');
    console.log('✅ DATABASE HAS BEEN COMPLETELY WIPED CLEAN!');
    console.log('All collections have 0 documents.');
    console.log('===============================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[Reset Error]:', err);
    process.exit(1);
  }
};

resetDatabase();
