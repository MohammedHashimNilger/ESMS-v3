const mongoose = require('mongoose');
const authPlugin = require('./plugins');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  enrollmentNo: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 30 }, // MUR
  email: { type: String, lowercase: true, trim: true, maxlength: 120 },
  course: { type: String, required: true, trim: true, maxlength: 60 },
  branch: { type: String, required: true, trim: true, maxlength: 80 },
  year: { type: Number, required: true, min: 1, max: 8 },
  semester: { type: Number, required: true, min: 1, max: 16 },
  password: { type: String, select: false },
  isRegistered: { type: Boolean, default: false },
  registeredAt: Date,
  status: { type: String, enum: ['active', 'debarred'], default: 'active' },
}, { timestamps: true });

studentSchema.plugin(authPlugin);
// Indexes keep filtering/search fast at 5,000+ records (and far beyond)
studentSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
studentSchema.index({ course: 1, branch: 1, year: 1, semester: 1, status: 1 });
studentSchema.index({ year: 1, semester: 1 });
studentSchema.index({ name: 1 });

module.exports = mongoose.model('Student', studentSchema);
