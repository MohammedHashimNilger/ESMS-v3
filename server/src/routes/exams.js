const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const Allocation = require('../models/Allocation');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect } = require('../middleware/auth');
const { str, isDate, toInt, SHIFTS } = require('../utils/common');
const ds = require('../utils/datesheet');

router.use(protect('admin'));

function parseExam(b) {
  const data = {
    name: str(b.name), course: str(b.course), year: toInt(b.year, 1, 8, 'Year'),
    semester: b.semester === '' || b.semester == null ? null : toInt(b.semester, 1, 16, 'Semester'),
    startDate: str(b.startDate), endDate: str(b.endDate),
  };
  if (!data.name || !data.course) throw new HttpError(400, 'Exam name and course are required.');
  if (!isDate(data.startDate) || !isDate(data.endDate) || data.startDate > data.endDate) throw new HttpError(400, 'Enter a valid date range.');
  if (!Array.isArray(b.entries) || !b.entries.length) throw new HttpError(400, 'Add at least one paper (date, shift, subject).');
  if (b.entries.length > 400) throw new HttpError(400, 'Too many papers in one exam.');

  const seen = new Map(); // date|shift -> branches used
  data.entries = b.entries.map((e, i) => {
    const dm = Number(e.durationMin);
    const entry = { date: str(e.date), shift: str(e.shift), subject: str(e.subject), branch: str(e.branch), code: str(e.code).slice(0, 40), durationMin: Number.isFinite(dm) && dm > 0 && dm <= 1440 ? dm : null };
    if (e._id && /^[a-f\d]{24}$/i.test(String(e._id))) entry._id = e._id;
    const label = `Paper ${i + 1}`;
    if (!isDate(entry.date) || entry.date < data.startDate || entry.date > data.endDate) throw new HttpError(400, `${label}: date must fall within the exam dates.`);
    if (!SHIFTS.includes(entry.shift)) throw new HttpError(400, `${label}: choose a shift.`);
    if (!entry.subject) throw new HttpError(400, `${label}: subject is required.`);
    const key = `${entry.date}|${entry.shift}`;
    const used = seen.get(key) || [];
    if (used.includes('') || (entry.branch === '' && used.length) || used.includes(entry.branch)) {
      throw new HttpError(400, `${label}: this class already has a paper on ${entry.date} (${entry.shift}).`);
    }
    seen.set(key, [...used, entry.branch]);
    return entry;
  });
  data.entries.sort((a, b2) => a.date.localeCompare(b2.date) || SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b2.shift));
  return data;
}

router.get('/', asyncHandler(async (_req, res) => {
  res.json(await Exam.find().sort({ startDate: -1 }).lean());
}));

// Per-paper eligible vs seated counts
router.get('/:id/summary', asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id).lean();
  if (!exam) throw new HttpError(404, 'Exam not found.');
  const seated = await Allocation.aggregate([{ $match: { exam: exam._id } }, { $group: { _id: '$entryId', n: { $sum: 1 } } }]);
  const seatedMap = new Map(seated.map((s) => [String(s._id), s.n]));
  const base = { course: exam.course, year: exam.year, status: 'active', ...(exam.semester ? { semester: exam.semester } : {}) };
  const entries = await Promise.all(exam.entries.map(async (e) => ({
    ...e, eligible: await Student.countDocuments({ ...base, ...(e.branch ? { branch: e.branch } : {}) }), seated: seatedMap.get(String(e._id)) || 0,
  })));
  res.json({ ...exam, entries });
}));

router.post('/', asyncHandler(async (req, res) => {
  const exam = await Exam.create(parseExam(req.body));
  audit(req, 'EXAM_CREATED', exam.name);
  res.status(201).json(exam);
}));

// Saves new exam data and clears seat allocations that are no longer valid
async function applyExamUpdate(exam, data) {
  const examChanged = exam.course !== data.course || exam.year !== data.year || (exam.semester || null) !== (data.semester || null);
  const newById = new Map(data.entries.filter((e) => e._id).map((e) => [String(e._id), e]));
  let cleared = 0;
  for (const old of exam.entries) {
    const next = newById.get(String(old._id));
    const structural = !next || examChanged || next.date !== old.date || next.shift !== old.shift || (next.branch || '') !== (old.branch || '');
    if (structural) cleared += (await Allocation.deleteMany({ exam: exam._id, entryId: old._id })).deletedCount;
    else if (next.subject !== old.subject) await Allocation.updateMany({ exam: exam._id, entryId: old._id }, { $set: { subject: next.subject } });
  }
  Object.assign(exam, data);
  await exam.save();
  return cleared;
}

router.put('/:id', asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new HttpError(404, 'Exam not found.');
  const cleared = await applyExamUpdate(exam, parseExam(req.body));
  audit(req, 'EXAM_UPDATED', `${exam.name} (${cleared} seat allocations cleared)`);
  res.json({ exam, allocationsCleared: cleared });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const exam = await Exam.findByIdAndDelete(req.params.id);
  if (!exam) throw new HttpError(404, 'Exam not found.');
  await Allocation.deleteMany({ exam: exam._id });
  audit(req, 'EXAM_DELETED', exam.name);
  res.json({ message: 'Exam deleted.' });
}));


// ---------------- Datesheet import (Excel / CSV) ----------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.csv', '.xlsx', '.xls'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, 'Upload an Excel (.xlsx / .xls) or CSV file.'), ok);
  },
});

async function studentContext() {
  const agg = await Student.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: { course: '$course', branch: '$branch', year: '$year', semester: '$semester' }, n: { $sum: 1 } } },
  ]);
  const pairs = [];
  const seen = new Set();
  const counts = new Map();
  for (const a of agg) {
    const k = `${a._id.course}|${a._id.branch}`;
    if (!seen.has(k)) { seen.add(k); pairs.push({ course: a._id.course, branch: a._id.branch }); }
    counts.set(`${a._id.course}|${a._id.year}|${a._id.semester}|${a._id.branch}`, a.n);
  }
  return { pairs, counts };
}

const SAMPLE = [
  ['S.No', 'Course', 'Branch', 'Year', 'Semester', 'Subject Code', 'Subject Name', 'Date', 'Shift', 'Duration'],
  [1, 'B.Tech', 'CSE', 2, 3, 'BMAT903', 'NUMERICAL ANALYSIS AND PROBABILITY STATISTICS', '30-11-2026', 'M', '3 Hrs'],
  [2, 'B.Tech', 'IT', 2, 3, 'BECE911', 'DIGITAL SYSTEM DESIGN', '01-12-2026', 'M', '3 Hrs'],
  [3, 'B.Tech', 'CSE, IT, AIML, AIDS', 1, 1, 'BCSE001', 'INTRODUCTION TO COMPUTER SYSTEMS', '12-12-2026', 'A', '3 Hrs'],
  [4, 'BCA', '', 1, 1, 'BMUC010', 'ENGLISH COMMUNICATION', '10-12-2026', 'M', '3 Hrs'],
  [5, 'MBA & BBA-MBA', 'HRM', 'II/IV', 'III/VII', 'MBA-N231', 'OPERATION RESEARCH', '30-11-2026', 'A', '3 Hrs'],
];

router.get('/datesheet/template', (req, res) => {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="datesheet-template.csv"');
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    return res.send(SAMPLE.map((r) => r.map(q).join(',')).join('\n') + '\n');
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(SAMPLE);
  ws['!cols'] = [6, 14, 22, 8, 10, 14, 48, 12, 8, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Datesheet');
  const notes = XLSX.utils.aoa_to_sheet([
    ['Column', 'What to enter'],
    ['Course / Branch', 'Same names as in your student list. Leave Branch blank or write All for every branch of the course. Several branches: CSE, IT, AIML'],
    ['Year / Semester', 'Numbers (2) or Roman (II). For two classes in one row use II/IV with III/VII'],
    ['Date', 'DD-MM-YYYY (30-11-2026) or a real Excel date'],
    ['Shift', 'M or Morning, A or Afternoon'],
    ['Duration', '3 Hrs, 1.5 Hr, 90 min (optional)'],
    ['S.No', 'Ignored'],
  ]);
  notes['!cols'] = [{ wch: 18 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Instructions');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="datesheet-template.xlsx"');
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// Export all scheduled exams in official datesheet table format (.xlsx or .csv)
router.get('/datesheet/export', asyncHandler(async (req, res) => {
  const exams = await Exam.find().sort({ course: 1, year: 1, semester: 1 }).lean();
  const rows = [
    ['S.No.', 'Course', 'Branch', 'Year', 'Semester', 'Subject Code', 'Subject Name', 'Date', 'Shift', 'Duration'],
  ];
  const allEntries = [];
  for (const ex of exams) {
    for (const en of ex.entries) {
      allEntries.push({
        course: ex.course,
        branch: en.branch || '',
        year: ex.year,
        semester: ex.semester || '',
        code: en.code || '',
        subject: en.subject,
        date: en.date,
        shift: en.shift === 'Morning' ? 'M' : en.shift === 'Afternoon' ? 'A' : en.shift === 'Evening' ? 'E' : (en.shift || 'M'),
        duration: en.durationMin ? (en.durationMin >= 60 ? `${en.durationMin / 60} Hrs` : `${en.durationMin} Min`) : '3 Hrs',
      });
    }
  }

  allEntries.sort((a, b) =>
    a.course.localeCompare(b.course) ||
    a.branch.localeCompare(b.branch) ||
    a.year - b.year ||
    (a.semester || 0) - (b.semester || 0) ||
    a.date.localeCompare(b.date)
  );

  let sNo = 1;
  for (const en of allEntries) {
    const parts = (en.date || '').split('-');
    const dmy = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : en.date;
    rows.push([
      sNo++,
      en.course,
      en.branch,
      en.year,
      en.semester,
      en.code,
      en.subject,
      dmy,
      en.shift,
      en.duration,
    ]);
  }

  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="full-datesheet.csv"');
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    return res.send(rows.map((r) => r.map(q).join(',')).join('\n') + '\n');
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [6, 14, 18, 8, 10, 14, 48, 14, 8, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Datesheet');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="full-datesheet.xlsx"');
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}));

// Step 1: read the file, return editable rows + how course/branch names were matched
router.post('/datesheet/parse', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  let raw;
  try { raw = ds.readRows(req.file.buffer); } catch (e) { throw new HttpError(400, e.message); }
  if (!raw.length) throw new HttpError(400, 'The file has no papers in it.');
  if (raw.length > 10000) throw new HttpError(400, 'Maximum 10,000 rows per upload.');
  const rows = ds.toRows(raw).map((r) => ({ ...r, issues: ds.checkRow(r).errors }));
  const { pairs } = await studentContext();
  const maps = ds.describeMaps(rows, ds.buildMatcher(pairs));
  const title = path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[_]+/g, ' ').trim();
  res.json({ rows, maps, fileName: req.file.originalname, suggestedName: title.slice(0, 80) });
}));

// Step 2: dryRun = show what would be created; otherwise create / update the exams
router.post('/datesheet/commit', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) throw new HttpError(400, 'No rows to import.');
  if (rows.length > 10000) throw new HttpError(400, 'Too many rows.');
  const baseName = str(b.examName);
  if (!baseName) throw new HttpError(400, 'Enter a name for this exam session (e.g. End Term Nov-Dec 2026).');
  const mode = b.mode === 'replace' ? 'replace' : 'merge';

  const { pairs, counts } = await studentContext();
  const matcher = ds.buildMatcher(pairs, b.courseMap || {}, b.branchMap || {});
  const clean = rows.map((r) => ({
    row: Number(r.row) || 0, course: str(r.course), branch: str(r.branch), year: String(r.year ?? '').trim(), semester: String(r.semester ?? '').trim(),
    code: str(r.code), subject: str(r.subject), date: str(r.date), shift: str(r.shift),
    durationMin: Number.isFinite(Number(r.durationMin)) && Number(r.durationMin) > 0 ? Number(r.durationMin) : null,
  }));
  const plan = ds.buildPlan(clean, matcher, counts);
  const errors = plan.issues.filter((i) => i.level === 'error');
  const empty = plan.exams.filter((e) => e.entries.length && e.entries.every((x) => !x.eligible)).length;

  const classMap = new Map();
  for (const ex of plan.exams) {
    for (const en of ex.entries) {
      const branch = en.branch || 'All';
      const key = `${ex.course}|${branch}|${ex.year}|${ex.semester ?? ''}`;
      if (!classMap.has(key)) {
        classMap.set(key, {
          course: ex.course,
          branch,
          year: ex.year,
          semester: ex.semester || null,
          students: en.eligible || 0,
          papers: [],
        });
      }
      classMap.get(key).papers.push({
        subject: en.subject,
        code: en.code || '',
        date: en.date,
        shift: en.shift,
        durationMin: en.durationMin ?? null,
        row: en.row,
      });
    }
  }
  const classPreview = [...classMap.values()].sort((a, b) =>
    a.course.localeCompare(b.course) ||
    a.branch.localeCompare(b.branch) ||
    a.year - b.year ||
    (a.semester || 0) - (b.semester || 0)
  );
  for (const c of classPreview) {
    c.papers.sort((a, b) => a.date.localeCompare(b.date) || SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift));
  }

  const summary = {
    exams: plan.exams.length, papers: plan.exams.reduce((n, e) => n + e.entries.length, 0), rowsAccepted: plan.accepted, rowsSkipped: new Set(errors.map((i) => i.row)).size,
    classesWithoutStudents: empty, issues: plan.issues.slice(0, 300), issueCount: plan.issues.length,
    preview: plan.exams.slice(0, 400).map((e) => ({ course: e.course, year: e.year, semester: e.semester, papers: e.entries.length, students: Math.max(0, ...e.entries.map((x) => x.eligible || 0)) })),
    classPreview,
  };
  if (b.dryRun) return res.json({ ...summary, saved: false });
  if (!plan.exams.length) throw new HttpError(422, 'Nothing valid to import. Fix the highlighted rows.');
  if (errors.length && !b.skipInvalid) throw new HttpError(422, `${new Set(errors.map((i) => i.row)).size} rows have errors. Fix them, or choose "skip invalid rows".`, summary);

  let created = 0, updated = 0, cleared = 0;
  for (const ex of plan.exams) {
    const name = `${baseName} · ${ex.course} Y${ex.year}${ex.semester ? ` S${ex.semester}` : ''}`.slice(0, 120);
    const dates = ex.entries.map((e) => e.date).sort();
    const keyOf = (e) => `${e.date}|${e.shift}|${e.branch || ''}`;
    const existing = await Exam.findOne({ name, course: ex.course, year: ex.year, semester: ex.semester || null });
    const oldByKey = new Map((existing?.entries || []).map((e) => [keyOf(e), e]));
    const entries = ex.entries.map((e) => {
      const o = oldByKey.get(keyOf(e));
      return { ...(o ? { _id: o._id } : {}), date: e.date, shift: e.shift, subject: e.subject, branch: e.branch || '', code: e.code || '', durationMin: e.durationMin ?? null };
    });
    if (existing && mode === 'merge') {
      const kept = new Set(entries.map(keyOf));
      for (const o of existing.entries) {
        if (kept.has(keyOf(o))) continue;
        const clash = entries.some((n) => n.date === o.date && n.shift === o.shift && (!n.branch || !o.branch || n.branch === o.branch));
        if (!clash) entries.push({ _id: o._id, date: o.date, shift: o.shift, subject: o.subject, branch: o.branch || '', code: o.code || '', durationMin: o.durationMin ?? null });
      }
    }
    entries.sort((a, c) => a.date.localeCompare(c.date) || SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(c.shift));
    const all = entries.map((e) => e.date).sort();
    const data = { name, course: ex.course, year: ex.year, semester: ex.semester || null, startDate: all[0] || dates[0], endDate: all[all.length - 1] || dates[dates.length - 1], entries };
    if (existing) { cleared += await applyExamUpdate(existing, data); updated++; } else { await Exam.create(data); created++; }
  }
  audit(req, 'DATESHEET_IMPORTED', `${baseName}: ${created} exams created, ${updated} updated, ${plan.accepted} rows`);
  res.json({ ...summary, saved: true, created, updated, allocationsCleared: cleared });
}));

module.exports = router;
