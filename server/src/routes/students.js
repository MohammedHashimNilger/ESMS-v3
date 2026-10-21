const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const Student = require('../models/Student');
const Allocation = require('../models/Allocation');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect } = require('../middleware/auth');
const { str, escapeRegex, isEmail, normEnr, toInt, paging } = require('../utils/common');

router.use(protect('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.csv', '.xlsx', '.xls'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, 'Upload a .csv, .xlsx or .xls file.'), ok);
  },
});

function buildFilter(q) {
  const f = {};
  if (str(q.course)) f.course = str(q.course);
  if (str(q.branch)) f.branch = str(q.branch);
  if (str(q.year)) f.year = Number(q.year);
  if (str(q.semester)) f.semester = Number(q.semester);
  if (str(q.status)) f.status = str(q.status);
  const search = str(q.search);
  if (search) {
    const prefix = new RegExp('^' + escapeRegex(search), 'i');          // prefix match can use indexes
    f.$or = [{ enrollmentNo: prefix }, { name: new RegExp(escapeRegex(search), 'i') }];
  }
  return f;
}

// Distinct values for filter dropdowns
router.get('/filters', asyncHandler(async (_req, res) => {
  const [pairs, years, semesters] = await Promise.all([
    Student.aggregate([{ $group: { _id: { course: '$course', branch: '$branch' } } }]),
    Student.distinct('year'),
    Student.distinct('semester'),
  ]);
  const courses = [...new Set(pairs.map((p) => p._id.course))].sort();
  const branches = pairs.map((p) => p._id).sort((a, b) => (a.course + a.branch).localeCompare(b.course + b.branch));
  res.json({ courses, branches, years: years.sort((a, b) => a - b), semesters: semesters.sort((a, b) => a - b) });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query, 25, 100);
  const filter = buildFilter(req.query);
  const [data, total] = await Promise.all([
    Student.find(filter).sort({ year: 1, course: 1, branch: 1, enrollmentNo: 1 }).skip(skip).limit(limit).lean(),
    Student.countDocuments(filter),
  ]);
  res.json({ data: data.map(({ password, failedAttempts, lockUntil, __v, ...s }) => s), total, page, pages: Math.ceil(total / limit) });
}));

function parseStudent(b) {
  const s = {
    name: str(b.name), enrollmentNo: normEnr(b.enrollmentNo), course: str(b.course), branch: str(b.branch),
    year: toInt(b.year, 1, 8, 'Year'), semester: toInt(b.semester, 1, 16, 'Semester'),
  };
  if (!s.name || !s.enrollmentNo || !s.course || !s.branch) throw new HttpError(400, 'Name, MUR, course and branch are required.');
  const email = str(b.email).toLowerCase();
  if (email) { if (!isEmail(email)) throw new HttpError(400, 'Invalid email.'); s.email = email; }
  if (['active', 'debarred'].includes(b.status)) s.status = b.status;
  return s;
}

router.post('/', asyncHandler(async (req, res) => {
  const student = await Student.create(parseStudent(req.body));
  audit(req, 'STUDENT_CREATED', student.enrollmentNo);
  res.status(201).json(student);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found.');
  const data = parseStudent({ ...req.body, enrollmentNo: student.enrollmentNo }); // MUR is immutable
  if (student.isRegistered) delete data.email; // registered students own their email
  Object.assign(student, data);
  await student.save();
  await Allocation.updateMany({ student: student._id }, { $set: {
    studentName: student.name, course: student.course, branch: student.branch, year: student.year, semester: student.semester,
  } });
  audit(req, 'STUDENT_UPDATED', student.enrollmentNo);
  res.json(student);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found.');
  await Allocation.deleteMany({ student: student._id });
  audit(req, 'STUDENT_DELETED', student.enrollmentNo);
  res.json({ message: 'Student deleted.' });
}));

// Lets a student re-register (forgotten password / wrong email) — admin-controlled recovery
router.post('/:id/reset-account', asyncHandler(async (req, res) => {
  const student = await Student.findByIdAndUpdate(req.params.id,
    { $set: { isRegistered: false, failedAttempts: 0, passwordChangedAt: new Date() }, $unset: { password: 1, lockUntil: 1, registeredAt: 1, email: 1 } });
  if (!student) throw new HttpError(404, 'Student not found.');
  audit(req, 'STUDENT_ACCOUNT_RESET', student.enrollmentNo);
  res.json({ message: 'Account reset. The student can sign up again.' });
}));

// ---------------- Bulk import (CSV / Excel) ----------------
const ALIASES = {
  name: ['name', 'studentname', 'fullname'],
  enrollmentNo: ['enrollmentno', 'enrollmentnumber', 'enrollment', 'enrolmentno', 'mur', 'murno', 'murnumber', 'rollno'],
  email: ['email', 'emailid', 'emailaddress'],
  course: ['course', 'program', 'programme'],
  branch: ['branch', 'department', 'dept', 'stream'],
  year: ['year'],
  semester: ['semester', 'sem'],
};
const WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 };
function parseNum(v) {
  const t = String(v).trim().toLowerCase();
  if (WORDS[t]) return WORDS[t];
  const m = t.match(/\d+/);
  return m ? Number(m[0]) : NaN;
}
function mapRow(raw) {
  const flat = {};
  for (const k of Object.keys(raw)) flat[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = raw[k];
  const out = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const key = names.find((n) => flat[n] !== undefined && String(flat[n]).trim() !== '');
    out[field] = key ? String(flat[key]).trim() : '';
  }
  return out;
}

router.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  } catch { throw new HttpError(400, 'Could not read this file. Use the template.'); }
  if (!rows.length) throw new HttpError(400, 'The file has no rows.');
  if (rows.length > 20000) throw new HttpError(400, 'Maximum 20,000 rows per upload. Split the file.');

  const errors = [];
  const valid = new Map(); // dedupe by MUR, last one wins
  rows.forEach((raw, i) => {
    const r = mapRow(raw);
    const rowNo = i + 2; // header is row 1
    const enrollmentNo = normEnr(r.enrollmentNo);
    const year = parseNum(r.year);
    const semester = parseNum(r.semester);
    const problem =
      !r.name || !enrollmentNo || !r.course || !r.branch ? 'Missing name, MUR, course or branch'
      : !(year >= 1 && year <= 8) ? 'Year must be 1-8'
      : !(semester >= 1 && semester <= 16) ? 'Semester must be 1-16'
      : r.email && !isEmail(r.email.toLowerCase()) ? 'Invalid email' : '';
    if (problem) { errors.push({ row: rowNo, message: problem }); return; }
    valid.set(enrollmentNo, { name: r.name, enrollmentNo, course: r.course, branch: r.branch, year, semester, email: r.email.toLowerCase() });
  });

  const list = [...valid.values()];
  let created = 0, updated = 0, emailConflicts = 0;
  const CHUNK = 1000; // chunked bulk writes: fast, bounded memory
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const result = await Student.bulkWrite(chunk.map((s) => ({
      updateOne: {
        filter: { enrollmentNo: s.enrollmentNo },
        update: {
          $set: { name: s.name, course: s.course, branch: s.branch, year: s.year, semester: s.semester },
          $setOnInsert: { isRegistered: false, status: 'active' },
        },
        upsert: true,
      },
    })), { ordered: false });
    created += result.upsertedCount; updated += result.matchedCount;

    const withEmail = chunk.filter((s) => s.email);
    if (withEmail.length) {
      try {
        await Student.bulkWrite(withEmail.map((s) => ({
          updateOne: { filter: { enrollmentNo: s.enrollmentNo, isRegistered: false }, update: { $set: { email: s.email } } },
        })), { ordered: false });
      } catch (e) { emailConflicts += (e.writeErrors || []).length || 1; }
    }
  }
  audit(req, 'STUDENTS_IMPORTED', `${created} new, ${updated} updated, ${errors.length} invalid`);
  res.json({ total: rows.length, created, updated, invalid: errors.length, emailConflicts, errors: errors.slice(0, 50) });
}));

router.get('/template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="students-template.csv"');
  res.send('Name,Enrollment No,Email,Course,Branch,Year,Semester\nAarav Sharma,MUR2025001,aarav@example.com,B.Tech,CSE,1,1\nRiya Verma,MUR2025002,,B.Tech,ECE,1,1\n');
});

module.exports = router;
