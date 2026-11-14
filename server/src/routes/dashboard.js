const router = require('express').Router();
const Student = require('../models/Student');
const Room = require('../models/Room');
const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { str, isDate, SHIFT_ORDER } = require('../utils/common');

router.use(protect('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const today = isDate(str(req.query.date)) ? str(req.query.date) : new Date().toISOString().slice(0, 10);
  const [students, registered, rooms, capAgg, exams, todayExams, todayCounts] = await Promise.all([
    Student.estimatedDocumentCount(),
    Student.countDocuments({ isRegistered: true }),
    Room.countDocuments({ isActive: true }),
    Room.aggregate([{ $match: { isActive: true } }, { $group: { _id: null, c: { $sum: { $subtract: [{ $multiply: ['$rows', '$columns'] }, { $size: '$disabledSeats' }] } } } }]),
    Exam.countDocuments(),
    Exam.find({ 'entries.date': today }).select('name course year entries').lean(),
    Allocation.aggregate([{ $match: { date: today } }, { $group: { _id: '$shift', n: { $sum: 1 }, rooms: { $addToSet: '$room' } } }]),
  ]);
  const counts = new Map(todayCounts.map((c) => [c._id, c]));
  const slots = [];
  for (const ex of todayExams) for (const e of ex.entries.filter((x) => x.date === today)) {
    slots.push({ exam: ex.name, course: ex.course, year: ex.year, branch: e.branch, shift: e.shift, subject: e.subject,
      seated: counts.get(e.shift)?.n || 0, rooms: counts.get(e.shift)?.rooms.length || 0 });
  }
  slots.sort((a, b) => SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift]);
  const upcoming = await Exam.find({ endDate: { $gte: today } }).sort({ startDate: 1 }).limit(5).select('name course year startDate endDate').lean();
  res.json({ today, stats: { students, registered, rooms, seats: capAgg[0]?.c || 0, exams }, slots, upcoming });
}));

module.exports = router;
