const mongoose = require('mongoose');
const authPlugin = require('./plugins');

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['superadmin', 'admin'], default: 'admin' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

adminSchema.plugin(authPlugin);
module.exports = mongoose.model('Admin', adminSchema);
