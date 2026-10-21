const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Student = require('../models/Student');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');

const COOKIE = 'token';
const DAY = 24 * 60 * 60 * 1000;

function issueToken(res, user, role) {
  const token = jwt.sign({ id: user._id, role }, process.env.JWT_SECRET, { expiresIn: '1d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,                                   // JS can't read it -> XSS can't steal it
    sameSite: 'lax',                                  // blocks cross-site POSTs (CSRF)
    secure: process.env.NODE_ENV === 'production',    // HTTPS only in production
    maxAge: DAY,
    path: '/',
  });
}
const clearToken = (res) => res.clearCookie(COOKIE, { path: '/' });

/** protect('admin') / protect('student') / protect() for any logged-in user. */
const protect = (...roles) => asyncHandler(async (req, _res, next) => {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) throw new HttpError(401, 'Please log in.');
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { throw new HttpError(401, 'Session expired. Please log in again.'); }

  const Model = decoded.role === 'admin' ? Admin : decoded.role === 'student' ? Student : null;
  if (!Model) throw new HttpError(401, 'Invalid session.');
  const user = await Model.findById(decoded.id);
  if (!user) throw new HttpError(401, 'Account no longer exists.');
  if (decoded.role === 'student' && !user.isRegistered) throw new HttpError(401, 'Account is not active.');
  if (user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    throw new HttpError(401, 'Password was changed. Please log in again.');
  }
  if (roles.length && !roles.includes(decoded.role)) throw new HttpError(403, 'You do not have access to this resource.');
  req.user = user;
  req.role = decoded.role;
  next();
});

const superOnly = (req, _res, next) =>
  req.role === 'admin' && req.user.role === 'superadmin' ? next() : next(new HttpError(403, 'Super admin access required.'));

module.exports = { protect, superOnly, issueToken, clearToken };
