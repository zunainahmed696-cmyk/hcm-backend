import mongoose, { Schema } from 'mongoose';

// Tenant configuration document: company profile + attendance/office rules (Module M2).
const SettingsSchema = new Schema(
  {
    companyName: { type: String, required: true, trim: true },
    officeStart: { type: String, default: '09:00' }, // HH:mm
    graceMinutes: { type: Number, default: 15 },
    halfDayHours: { type: Number, default: 5 },
    weekend: { type: [Number], default: [0, 6] }, // 0 = Sunday ... 6 = Saturday
    office: {
      address: { type: String, default: '' },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      radiusMeters: { type: Number, default: 150 },
    },
  },
  { timestamps: true }
);

export const Settings = mongoose.model('Settings', SettingsSchema);
