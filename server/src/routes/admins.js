const router = require('express').Router();
const Admin = require('../models/Admin');
const AuditLog = require('../models/AuditLog');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect, superOnly } = require('../middleware/auth');
const { str, isEmail, assertPassword } = require('../utils/common');

router.use(protect('admin'), superOnly);

router.get('/', asyncHandler(async (_req, res) => res.json(await Admin.find().sort({ createdAt: 1 }).lean())));

router.post('/', asyncHandler(async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  if (!str(req.body.name) || !isEmail(email)) throw new HttpError(400, 'Name and a valid email are required.');
  assertPassword(req.body.password);
  const admin = await Admin.create({ name: str(req.body.name), email, password: req.body.password, role: 'admin', createdBy: req.user._id });
  audit(req, 'ADMIN_CREATED', email);
  res.status(201).json(admin);
}));

router.put('/:id/password', asyncHandler(async (req, res) => {
  assertPassword(req.body.password);
  const admin = await Admin.findById(req.params.id).select('+password');
  if (!admin) throw new HttpError(404, 'Admin not found.');
  if (admin.role === 'superadmin' && String(admin._id) !== String(req.user._id)) throw new HttpError(403, 'Cannot reset another super admin.');
  admin.password = req.body.password;
  admin.failedAttempts = 0; admin.lockUntil = undefined;
  await admin.save();
  audit(req, 'ADMIN_PASSWORD_RESET', admin.email);
  res.json({ message: 'Password reset. Existing sessions of that admin are signed out.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const admin = await Admin.findById(req.params.id);
  if (!admin) throw new HttpError(404, 'Admin not found.');
  if (admin.role === 'superadmin') throw new HttpError(400, 'The super admin cannot be deleted.');
  await admin.deleteOne();
  audit(req, 'ADMIN_DELETED', admin.email);
  res.json({ message: 'Admin removed.' });
}));

router.get('/audit/log', asyncHandler(async (_req, res) => res.json(await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean())));

module.exports = router;
