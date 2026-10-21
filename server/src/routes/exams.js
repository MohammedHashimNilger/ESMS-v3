const router = require('express').Router();
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const Allocation = require('../models/Allocation');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect } = require('../middleware/auth');
const { str, isDate, toInt, SHIFTS } = require('../utils/common');

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
    const entry = { date: str(e.date), shift: str(e.shift), subject: str(e.subject), branch: str(e.branch) };
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

router.put('/:id', asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new HttpError(404, 'Exam not found.');
  const data = parseExam(req.body);

  // Work out which existing seat allocations are no longer valid
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

module.exports = router;
