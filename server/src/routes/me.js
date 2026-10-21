const router = require('express').Router();
const Allocation = require('../models/Allocation');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');

router.use(protect('student'));

// A student only ever receives HIS OWN seats. Other occupied seats are sent as bare
// seat numbers (no names) so the room grid looks real without leaking anyone's data.
router.get('/overview', asyncHandler(async (req, res) => {
  const s = req.user;
  const [allocs, shifts] = await Promise.all([
    Allocation.find({ student: s._id }).sort({ date: 1, shiftOrder: 1 })
      .populate('room', 'name building floor rows columns disabledSeats').lean(),
    Setting.getShifts(),
  ]);
  const exams = await Promise.all(allocs.map(async (a) => ({
    _id: a._id, date: a.date, shift: a.shift, time: shifts[a.shift] || null, subject: a.subject,
    seatNumber: a.seatNumber, row: a.row, col: a.col, room: a.room,
    occupied: await Allocation.find({ date: a.date, shift: a.shift, room: a.room._id }).distinct('seatNumber'),
  })));
  res.json({
    student: { name: s.name, enrollmentNo: s.enrollmentNo, email: s.email, course: s.course, branch: s.branch, year: s.year, semester: s.semester },
    exams,
  });
}));

module.exports = router;
