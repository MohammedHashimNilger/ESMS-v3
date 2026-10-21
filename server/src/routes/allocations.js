const router = require('express').Router();
const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const Room = require('../models/Room');
const Allocation = require('../models/Allocation');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect } = require('../middleware/auth');
const { allocate } = require('../utils/allocator');
const { str, escapeRegex, isDate, paging, naturalCompare, SHIFTS, SHIFT_ORDER, groupLabel, seatToCell } = require('../utils/common');

router.use(protect('admin'));
const oid = (id) => { if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id.'); return new mongoose.Types.ObjectId(id); };

function slotParams(src) {
  const date = str(src.date), shift = str(src.shift);
  if (!isDate(date) || !SHIFTS.includes(shift)) throw new HttpError(400, 'Choose a valid date and shift.');
  return { date, shift };
}

// All students writing any paper in this date+shift (across every exam)
async function collectSlot(date, shift) {
  const exams = await Exam.find({ entries: { $elemMatch: { date, shift } } }).lean();
  if (!exams.length) throw new HttpError(404, 'No exam is scheduled for this date and shift.');
  const students = [];
  const seen = new Set();
  let duplicates = 0;
  for (const exam of exams) {
    for (const entry of exam.entries.filter((e) => e.date === date && e.shift === shift)) {
      const q = { course: exam.course, year: exam.year, status: 'active' };
      if (exam.semester) q.semester = exam.semester;
      if (entry.branch) q.branch = entry.branch;
      const found = await Student.find(q).select('name enrollmentNo course branch year semester').lean();
      for (const s of found) {
        if (seen.has(String(s._id))) { duplicates++; continue; }
        seen.add(String(s._id));
        students.push({ ...s, group: groupLabel(s), examId: exam._id, entryId: entry._id, subject: entry.subject });
      }
    }
  }
  return { students, exams, duplicates };
}

async function runSlot({ date, shift, roomIds, dryRun }) {
  const { students, duplicates } = await collectSlot(date, shift);
  const roomQuery = Array.isArray(roomIds) && roomIds.length ? { _id: { $in: roomIds.map(oid) } } : { isActive: true };
  const rooms = (await Room.find(roomQuery).lean()).sort((a, b) =>
    naturalCompare(a.building, b.building) || a.floor - b.floor || naturalCompare(a.name, b.name));
  if (!rooms.length) throw new HttpError(400, 'No rooms available. Add rooms first.');

  const { placements, unallocated, roomsUsed } = allocate(students, rooms);
  const capacity = rooms.reduce((n, r) => n + r.rows * r.columns - r.disabledSeats.length, 0);

  const roomSummary = new Map();
  const groupCounts = new Map();
  for (const p of placements) {
    const key = String(p.room._id);
    if (!roomSummary.has(key)) roomSummary.set(key, { name: p.room.name, building: p.room.building, floor: p.room.floor, count: 0, groups: new Set() });
    const r = roomSummary.get(key); r.count++; r.groups.add(p.student.group);
    groupCounts.set(p.student.group, (groupCounts.get(p.student.group) || 0) + 1);
  }
  const summary = {
    date, shift, eligible: students.length, seated: placements.length, unseated: unallocated.length,
    roomsAvailable: rooms.length, roomsNeeded: roomsUsed.length, rawCapacity: capacity, duplicates,
    groups: [...groupCounts].map(([label, count]) => ({ label, count })),
    rooms: [...roomSummary.values()].map((r) => ({ ...r, groups: [...r.groups] })),
  };
  if (dryRun) return { ...summary, saved: false };

  if (unallocated.length) {
    throw new HttpError(422, `Not enough seats: ${unallocated.length} of ${students.length} students could not be seated. Add rooms or select more rooms.`, summary);
  }

  const docs = placements.map((p) => ({
    date, shift, shiftOrder: SHIFT_ORDER[shift], exam: p.student.examId, entryId: p.student.entryId, subject: p.student.subject,
    student: p.student._id, studentName: p.student.name, enrollmentNo: p.student.enrollmentNo,
    course: p.student.course, branch: p.student.branch, year: p.student.year, semester: p.student.semester, group: p.student.group,
    room: p.room._id, roomName: p.room.name, building: p.room.building, floor: p.room.floor,
    seatNumber: p.seatNumber, row: p.row, col: p.col,
  }));
  await Allocation.deleteMany({ date, shift });
  const CHUNK = 1000;
  for (let i = 0; i < docs.length; i += CHUNK) await Allocation.insertMany(docs.slice(i, i + CHUNK), { ordered: false, lean: true });
  return { ...summary, saved: true };
}

router.post('/run', asyncHandler(async (req, res) => {
  const { date, shift } = slotParams(req.body);
  const result = await runSlot({ date, shift, roomIds: req.body.roomIds, dryRun: !!req.body.dryRun });
  if (result.saved) audit(req, 'ALLOCATED', `${date} ${shift}: ${result.seated} students, ${result.roomsNeeded} rooms`);
  res.json(result);
}));

router.delete('/slot', asyncHandler(async (req, res) => {
  const { date, shift } = slotParams(req.query);
  const r = await Allocation.deleteMany({ date, shift });
  audit(req, 'ALLOCATION_CLEARED', `${date} ${shift}: ${r.deletedCount}`);
  res.json({ deleted: r.deletedCount });
}));

// Every scheduled date+shift with how many students are seated
router.get('/slots', asyncHandler(async (_req, res) => {
  const [exams, counts] = await Promise.all([
    Exam.find().select('name course year entries').lean(),
    Allocation.aggregate([{ $group: { _id: { date: '$date', shift: '$shift' }, n: { $sum: 1 } } }]),
  ]);
  const countMap = new Map(counts.map((c) => [`${c._id.date}|${c._id.shift}`, c.n]));
  const slots = new Map();
  for (const ex of exams) for (const e of ex.entries) {
    const k = `${e.date}|${e.shift}`;
    if (!slots.has(k)) slots.set(k, { date: e.date, shift: e.shift, papers: [], allocated: countMap.get(k) || 0 });
    slots.get(k).papers.push({ exam: ex.name, course: ex.course, year: ex.year, branch: e.branch, subject: e.subject });
  }
  res.json([...slots.values()].sort((a, b) => a.date.localeCompare(b.date) || SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift]));
}));

function buildFilter(q) {
  const f = {};
  if (isDate(str(q.date))) f.date = str(q.date);
  if (SHIFTS.includes(str(q.shift))) f.shift = str(q.shift);
  if (str(q.course)) f.course = str(q.course);
  if (str(q.branch)) f.branch = str(q.branch);
  if (str(q.year)) f.year = Number(q.year);
  if (str(q.semester)) f.semester = Number(q.semester);
  if (mongoose.isValidObjectId(str(q.room))) f.room = oid(q.room);
  const s = str(q.search);
  if (s) f.$or = [{ enrollmentNo: new RegExp('^' + escapeRegex(s), 'i') }, { studentName: new RegExp(escapeRegex(s), 'i') }];
  return f;
}
const SORT = { date: 1, shiftOrder: 1, building: 1, roomName: 1, seatNumber: 1 };

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query, 25, 100);
  const filter = buildFilter(req.query);
  const [data, total] = await Promise.all([
    Allocation.find(filter).sort(SORT).skip(skip).limit(limit).select('-exam -entryId -shiftOrder -createdAt -updatedAt -__v').lean(),
    Allocation.countDocuments(filter),
  ]);
  res.json({ data, total, page, pages: Math.ceil(total / limit) });
}));

// Streamed CSV export: constant memory even for 50k rows
router.get('/export', asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="seating-plan.csv"');
  const esc = (v) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // also blocks CSV/Excel formula injection
  res.write('Date,Shift,MUR,Name,Course,Branch,Year,Semester,Subject,Building,Room,Floor,Seat\n');
  for await (const a of Allocation.find(filter).sort(SORT).lean().cursor()) {
    res.write([a.date, a.shift, a.enrollmentNo, a.studentName, a.course, a.branch, a.year, a.semester, a.subject, a.building, a.roomName, a.floor, a.seatNumber].map(esc).join(',') + '\n');
  }
  res.end();
}));

// Rooms in use for a slot, with which classes sit in each
router.get('/rooms', asyncHandler(async (req, res) => {
  const { date, shift } = slotParams(req.query);
  const agg = await Allocation.aggregate([
    { $match: { date, shift } },
    { $group: { _id: { room: '$room', group: '$group' }, n: { $sum: 1 } } },
  ]);
  const byRoom = new Map();
  for (const a of agg) {
    const k = String(a._id.room);
    if (!byRoom.has(k)) byRoom.set(k, { total: 0, groups: [] });
    const r = byRoom.get(k); r.total += a.n; r.groups.push({ label: a._id.group, count: a.n });
  }
  const rooms = await Room.find({ _id: { $in: [...byRoom.keys()].map(oid) } }).lean();
  res.json(rooms
    .map((r) => ({ _id: r._id, name: r.name, building: r.building, floor: r.floor, capacity: r.rows * r.columns - r.disabledSeats.length, ...byRoom.get(String(r._id)) }))
    .sort((a, b) => naturalCompare(a.building, b.building) || a.floor - b.floor || naturalCompare(a.name, b.name)));
}));

// Full seat grid of one room for one slot
router.get('/room/:roomId', asyncHandler(async (req, res) => {
  const { date, shift } = slotParams(req.query);
  const room = await Room.findById(oid(req.params.roomId)).lean();
  if (!room) throw new HttpError(404, 'Room not found.');
  const allocs = await Allocation.find({ date, shift, room: room._id }).select('seatNumber studentName enrollmentNo group subject course branch year semester').lean();
  const bySeat = new Map(allocs.map((a) => [a.seatNumber, a]));
  const disabled = new Set(room.disabledSeats);
  const groups = [...new Set(allocs.map((a) => a.group))].sort(naturalCompare);
  const seats = [];
  for (let n = 1; n <= room.rows * room.columns; n++) {
    const a = bySeat.get(n);
    const { row, col } = seatToCell(n, room.rows);
    seats.push(a
      ? { seatNumber: n, row, col, state: 'occupied', allocationId: a._id, name: a.studentName, enrollmentNo: a.enrollmentNo, group: a.group, groupIndex: groups.indexOf(a.group), subject: a.subject }
      : { seatNumber: n, row, col, state: disabled.has(n) ? 'disabled' : 'empty' });
  }
  res.json({ room: { ...room, capacity: room.rows * room.columns - room.disabledSeats.length }, date, shift, groups, count: allocs.length, seats });
}));

// Manual override: move a student to an empty seat in the same room
router.put('/:id/move', asyncHandler(async (req, res) => {
  const a = await Allocation.findById(oid(req.params.id));
  if (!a) throw new HttpError(404, 'Allocation not found.');
  const room = await Room.findById(a.room).lean();
  const n = Number(req.body.seatNumber);
  if (!Number.isInteger(n) || n < 1 || n > room.rows * room.columns) throw new HttpError(400, 'Invalid seat.');
  if (room.disabledSeats.includes(n)) throw new HttpError(400, 'That seat is disabled.');
  if (await Allocation.exists({ date: a.date, shift: a.shift, room: a.room, seatNumber: n })) throw new HttpError(409, 'That seat is already taken.');
  const { row, col } = seatToCell(n, room.rows);
  Object.assign(a, { seatNumber: n, row, col });
  await a.save();
  audit(req, 'SEAT_MOVED', `${a.enrollmentNo} -> ${room.name} seat ${n} (${a.date} ${a.shift})`);
  res.json({ message: 'Seat updated.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const a = await Allocation.findByIdAndDelete(oid(req.params.id));
  if (!a) throw new HttpError(404, 'Allocation not found.');
  audit(req, 'SEAT_REMOVED', `${a.enrollmentNo} (${a.date} ${a.shift})`);
  res.json({ message: 'Student removed from this seat.' });
}));

module.exports = router;
