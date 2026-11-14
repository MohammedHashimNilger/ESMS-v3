const HttpError = require('./httpError');

const SHIFTS = ['Morning', 'Afternoon', 'Evening'];
const SHIFT_ORDER = { Morning: 0, Afternoon: 1, Evening: 2 };

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
const normName = (n) => str(n).replace(/\s+/g, ' ').toLowerCase();
const normEnr = (e) => str(e).replace(/\s+/g, '').toUpperCase();

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function assertPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 72 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) {
    throw new HttpError(400, 'Password must be 8-72 characters and include at least one letter and one number.');
  }
}

function toInt(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`);
  return n;
}

// seat numbers run DOWN each column: 1..rows in column 1, then column 2, ...
const seatToCell = (n, rows) => ({ col: Math.floor((n - 1) / rows) + 1, row: ((n - 1) % rows) + 1 });

const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

function paging(q, defLimit = 25, maxLimit = 100) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
}

const groupLabel = (s) => `${s.course} ${s.branch} · Y${s.year} S${s.semester}`;

module.exports = {
  SHIFTS, SHIFT_ORDER, str, escapeRegex, isEmail, normName, normEnr, isDate,
  assertPassword, toInt, seatToCell, naturalCompare, paging, groupLabel,
};
