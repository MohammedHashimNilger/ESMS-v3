const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const Admin = require('../models/Admin');
const Student = require('../models/Student');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect, issueToken, clearToken } = require('../middleware/auth');
const { str, isEmail, normName, normEnr, assertPassword } = require('../utils/common');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many attempts from this network. Try again in 15 minutes.' },
});

async function verifyLogin(doc, password) {
  if (!doc || !doc.password) throw new HttpError(401, 'Invalid credentials.');
  if (doc.isLocked()) throw new HttpError(423, 'Too many failed attempts. Account locked for 15 minutes.');
  if (!(await doc.comparePassword(password))) {
    await doc.registerFailure();
    throw new HttpError(401, 'Invalid credentials.');
  }
  await doc.resetFailures();
}

// ---- Student signup: only students present in the admin-uploaded master list can register ----
router.post('/student/signup', authLimiter, asyncHandler(async (req, res) => {
  const name = str(req.body.name);
  const enrollmentNo = normEnr(req.body.enrollmentNo);
  const email = str(req.body.email).toLowerCase();
  const password = req.body.password;
  if (!name || !enrollmentNo || !isEmail(email)) throw new HttpError(400, 'Enter your name, MUR / enrollment number and a valid email.');
  assertPassword(password);

  const mismatch = new HttpError(400, 'These details do not match university records. Check your name and MUR, or contact the exam cell.');
  const student = await Student.findOne({ enrollmentNo }).select('+password');
  if (!student) throw mismatch;
  if (student.isRegistered) throw new HttpError(409, 'An account already exists for this MUR. Please log in.');
  if (normName(student.name) !== normName(name)) throw mismatch;
  if (student.email && student.email !== email) throw mismatch;
  if (await Student.exists({ email, _id: { $ne: student._id } })) throw new HttpError(409, 'This email is already used by another account.');

  student.email = email;
  student.password = password;
  student.isRegistered = true;
  student.registeredAt = new Date();
  await student.save();
  issueToken(res, student, 'student');
  res.status(201).json({ role: 'student', user: student });
}));

router.post('/student/login', authLimiter, asyncHandler(async (req, res) => {
  const enrollmentNo = normEnr(req.body.enrollmentNo);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const student = enrollmentNo ? await Student.findOne({ enrollmentNo, isRegistered: true }).select('+password') : null;
  await verifyLogin(student, password);
  issueToken(res, student, 'student');
  res.json({ role: 'student', user: student });
}));

router.post('/admin/login', authLimiter, asyncHandler(async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const admin = email ? await Admin.findOne({ email }).select('+password') : null;
  await verifyLogin(admin, password);
  issueToken(res, admin, 'admin');
  req.user = admin; audit(req, 'LOGIN');
  res.json({ role: 'admin', user: admin });
}));

router.post('/logout', (_req, res) => { clearToken(res); res.json({ message: 'Logged out.' }); });

router.get('/me', protect(), (req, res) => res.json({ role: req.role, user: req.user }));

// ---- Admin (incl. super admin) can change own name / email / password ----
router.put('/admin/profile', protect('admin'), asyncHandler(async (req, res) => {
  const admin = await Admin.findById(req.user._id).select('+password');
  const name = str(req.body.name) || admin.name;
  const email = str(req.body.email).toLowerCase() || admin.email;
  const newPassword = req.body.newPassword;
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email.');

  const emailChanged = email !== admin.email;
  if (emailChanged || newPassword) {
    if (!(await admin.comparePassword(typeof req.body.currentPassword === 'string' ? req.body.currentPassword : ''))) {
      throw new HttpError(400, 'Current password is incorrect.');
    }
  }
  if (emailChanged && (await Admin.exists({ email, _id: { $ne: admin._id } }))) throw new HttpError(409, 'That email is already used by another admin.');
  if (newPassword) { assertPassword(newPassword); admin.password = newPassword; }
  admin.name = name; admin.email = email;
  await admin.save();
  if (newPassword) issueToken(res, admin, 'admin'); // old sessions die, this one continues
  req.user = admin;
  audit(req, 'PROFILE_UPDATED', `${emailChanged ? 'email changed ' : ''}${newPassword ? 'password changed' : ''}`);
  res.json({ user: admin, message: 'Profile updated.' });
}));

router.put('/student/password', protect('student'), asyncHandler(async (req, res) => {
  const student = await Student.findById(req.user._id).select('+password');
  if (!(await student.comparePassword(typeof req.body.currentPassword === 'string' ? req.body.currentPassword : ''))) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  assertPassword(req.body.newPassword);
  student.password = req.body.newPassword;
  await student.save();
  issueToken(res, student, 'student');
  res.json({ message: 'Password updated.' });
}));

module.exports = router;
