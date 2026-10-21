const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  actorName: String,
  action: { type: String, required: true },
  details: String,
  ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

auditSchema.index({ createdAt: -1 });
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 }); // keep one year

module.exports = mongoose.model('AuditLog', auditSchema);
