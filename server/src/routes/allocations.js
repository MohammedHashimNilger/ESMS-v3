const router = require('express').Router();
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const Room = require('../models/Room');
const Allocation = require('../models/Allocation');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect } = require('../middleware/auth');
const { allocate } = require('../utils/allocator');
const { str, escapeRegex, isDate, paging, naturalCompare, SHIFTS, SHIFT_ORDER, groupLabel, seatToCell, normEnr } = require('../utils/common');
const ds = require('../utils/datesheet');

router.use(protect('admin'));
const oid = (id) => { if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id.'); return new mongoose.Types.ObjectId(id); };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.csv', '.xlsx', '.xls'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new HttpError(400, 'Upload an Excel (.xlsx / .xls) or CSV file.'), ok);
  },
});

function slotParams(src) {
  const date = str(src.date), shift = str(src.shift);
  if (!isDate(date) || !SHIFTS.includes(shift)) throw new HttpError(400, 'Choose a valid date and shift.');
  return { date, shift };
}

// ---------------------------------------------------------------------------
// Period allocation: every student gets ONE room + seat for ALL papers in the period.
// ---------------------------------------------------------------------------
function periodParams(src) {
  const from = str(src.from), to = str(src.to);
  if (!isDate(from) || !isDate(to) || from > to) throw new HttpError(400, 'Choose a valid exam period (from and to dates).');
  return { from, to };
}

// Students with every paper they write in [from, to]
async function collectPeriod(from, to) {
  const exams = await Exam.find({ entries: { $elemMatch: { date: { $gte: from, $lte: to } } } }).lean();
  if (!exams.length) throw new HttpError(404, 'No exam is scheduled in this period.');
  const byClass = new Map(); // course|year -> [{ exam, entries }]
  const conds = new Map();
  for (const exam of exams) {
    const entries = exam.entries.filter((e) => e.date >= from && e.date <= to);
    if (!entries.length) continue;
    const k = `${exam.course}|${exam.year}`;
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push({ exam, entries });
    const c = { course: exam.course, year: exam.year, ...(exam.semester ? { semester: exam.semester } : {}) };
    conds.set(JSON.stringify(c), c);
  }
  const found = await Student.find({ status: 'active', $or: [...conds.values()] }).select('name enrollmentNo course branch year semester').lean();
  const students = [];
  const groupShifts = new Map();
  const info = new Map();
  let clashes = 0;
  for (const s of found) {
    const slots = new Map(); // date|shift -> slot
    for (const { exam, entries } of byClass.get(`${s.course}|${s.year}`) || []) {
      if (exam.semester && exam.semester !== s.semester) continue;
      for (const e of entries) {
        if (e.branch && e.branch !== s.branch) continue;
        const k = `${e.date}|${e.shift}`;
        if (slots.has(k)) { clashes++; continue; } // two papers in one slot: seat once
        slots.set(k, { date: e.date, shift: e.shift, examId: exam._id, entryId: e._id, subject: e.subject });
      }
    }
    if (!slots.size) continue;
    const group = groupLabel(s);
    if (!groupShifts.has(group)) { groupShifts.set(group, new Set()); info.set(group, { label: group, count: 0, subjects: new Set(), from: '9999', to: '0000', papers: new Set() }); }
    const gi = info.get(group);
    gi.count++;
    for (const sl of slots.values()) { groupShifts.get(group).add(sl.shift); gi.subjects.add(sl.subject); gi.papers.add(`${sl.date}|${sl.shift}`); if (sl.date < gi.from) gi.from = sl.date; if (sl.date > gi.to) gi.to = sl.date; }
    students.push({ ...s, group, slots: [...slots.values()] });
  }
  const groups = [...info.values()].map((g) => ({ label: g.label, count: g.count, subjects: [...g.subjects], shifts: [...groupShifts.get(g.label)].sort((a, b) => SHIFT_ORDER[a] - SHIFT_ORDER[b]), from: g.from, to: g.to, papers: g.papers.size })).sort((a, b) => naturalCompare(a.label, b.label));
  return { students, groupShifts, groups, clashes };
}

const sortRooms = (rooms) => rooms.sort((a, b) => naturalCompare(a.building, b.building) || a.floor - b.floor || naturalCompare(a.name, b.name));
const roomCapacity = (r) => r.rows * r.columns - r.disabledSeats.length;

function cleanAssignments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 500).map((a) => ({
    roomId: String(a?.roomId || ''),
    groups: Array.isArray(a?.groups) ? a.groups.map(str).filter(Boolean).slice(0, 50) : [],
  })).filter((a) => mongoose.isValidObjectId(a.roomId) && a.groups.length);
}

async function runPeriod({ from, to, roomIds, dryRun, assignments, useFullRoom, allowPartial }) {
  const { students, groupShifts, groups, clashes } = await collectPeriod(from, to);
  const assign = cleanAssignments(assignments);
  const wanted = Array.isArray(roomIds) && roomIds.length ? roomIds.map(oid) : null;
  const roomQuery = wanted ? { _id: { $in: wanted } } : { isActive: true };
  if (assign.length && wanted) roomQuery._id = { $in: [...new Set([...roomIds, ...assign.map((a) => a.roomId)])].map(oid) };
  const rooms = sortRooms(await Room.find(roomQuery).lean());
  if (!rooms.length) throw new HttpError(400, 'No rooms available. Add rooms first.');

  const { placements, unallocated, roomsUsed, manualRooms, warnings } = allocate(students, rooms, { assignments: assign, useFullRoom: !!useFullRoom, groupShifts });
  const capacity = rooms.reduce((n, r) => n + roomCapacity(r), 0);

  const roomSummary = new Map();
  const manualIds = new Set(manualRooms.map((r) => String(r._id)));
  for (const p of placements) {
    const key = String(p.room._id);
    if (!roomSummary.has(key)) roomSummary.set(key, { name: p.room.name, building: p.room.building, floor: p.room.floor, count: 0, groups: new Set(), manual: manualIds.has(key) });
    const r = roomSummary.get(key); r.count++; r.groups.add(p.student.group);
  }
  const unseatedBy = new Map();
  for (const s of unallocated) unseatedBy.set(s.group, (unseatedBy.get(s.group) || 0) + 1);
  const papers = students.reduce((n, s) => n + s.slots.length, 0);
  const summary = {
    from, to, eligible: students.length, seated: placements.length, unseated: unallocated.length, papers,
    roomsAvailable: rooms.length, roomsNeeded: roomsUsed.length, manualRooms: manualRooms.length, rawCapacity: capacity, duplicates: clashes, warnings,
    groups, unseatedGroups: [...unseatedBy].map(([label, count]) => ({ label, count })),
    rooms: [...roomSummary.values()].map((r) => ({ ...r, groups: [...r.groups] })),
  };
  if (dryRun) return { ...summary, saved: false };

  if (unallocated.length && !allowPartial) {
    throw new HttpError(422, `Not enough seats: ${unallocated.length} of ${students.length} students could not be seated. Add rooms, select more rooms, or choose "Save even if some students get no seat".`, summary);
  }
  if (!placements.length) throw new HttpError(422, 'Nothing could be seated.', summary);

  const period = `${from}_${to}`;
  const docs = [];
  for (const p of placements) {
    const st = p.student;
    for (const sl of st.slots) {
      docs.push({
        date: sl.date, shift: sl.shift, shiftOrder: SHIFT_ORDER[sl.shift], exam: sl.examId, entryId: sl.entryId, subject: sl.subject, period,
        student: st._id, studentName: st.name, enrollmentNo: st.enrollmentNo, course: st.course, branch: st.branch, year: st.year, semester: st.semester, group: st.group,
        room: p.room._id, roomName: p.room.name, building: p.room.building, floor: p.room.floor, seatNumber: p.seatNumber, row: p.row, col: p.col,
      });
    }
  }
  // Replace the old plan safely: if inserting fails, the previous plan is put back.
  const range = { date: { $gte: from, $lte: to } };
  const backup = await Allocation.find(range).lean();
  await Allocation.deleteMany(range);
  try {
    const CHUNK = 2000;
    for (let i = 0; i < docs.length; i += CHUNK) await Allocation.insertMany(docs.slice(i, i + CHUNK), { ordered: false, lean: true });
  } catch (e) {
    await Allocation.deleteMany(range);
    if (backup.length) await Allocation.insertMany(backup, { ordered: false, lean: true }).catch(() => {});
    throw e;
  }
  return { ...summary, saved: true, period };
}

router.post('/run', asyncHandler(async (req, res) => {
  const { from, to } = periodParams(req.body);
  const result = await runPeriod({ from, to, roomIds: req.body.roomIds, dryRun: !!req.body.dryRun, assignments: req.body.assignments, useFullRoom: req.body.useFullRoom, allowPartial: req.body.allowPartial });
  if (result.saved) audit(req, 'ALLOCATED', `${from} to ${to}: ${result.seated} seated, ${result.unseated} unseated, ${result.roomsNeeded} rooms (${result.manualRooms} manual)`);
  res.json(result);
}));

// Classes writing in a period (for manual room assignment)
router.get('/classes', asyncHandler(async (req, res) => {
  const { from, to } = periodParams(req.query);
  res.json((await collectPeriod(from, to)).groups);
}));

// Overall exam period + the allocation runs that exist
router.get('/period', asyncHandler(async (_req, res) => {
  const [exams, runs] = await Promise.all([
    Exam.aggregate([{ $unwind: '$entries' }, { $group: { _id: null, from: { $min: '$entries.date' }, to: { $max: '$entries.date' } } }]),
    Allocation.aggregate([{ $match: { period: { $ne: '' } } }, { $group: { _id: '$period', seats: { $sum: 1 }, students: { $addToSet: '$student' } } }, { $project: { seats: 1, students: { $size: '$students' } } }, { $sort: { _id: 1 } }]),
  ]);
  res.json({ from: exams[0]?.from || '', to: exams[0]?.to || '', runs: runs.map((r) => ({ period: r._id, papers: r.seats, students: r.students })) });
}));

router.delete('/period', asyncHandler(async (req, res) => {
  const { from, to } = periodParams(req.query);
  const r = await Allocation.deleteMany({ date: { $gte: from, $lte: to } });
  audit(req, 'ALLOCATION_CLEARED', `${from} to ${to}: ${r.deletedCount}`);
  res.json({ deleted: r.deletedCount });
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

// Full seating plan (CSV): ONE row per student, because a student keeps the same seat for the whole period.
// No date / shift / subject columns. Sorted by building, floor, room, seat. Streamed: constant memory.
router.get('/export', asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="seating-plan.csv"');
  const esc = (v) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // also blocks CSV/Excel formula injection
  res.write('\ufeffName,MUR,Course,Branch,Semester,Year,Building,Room,Floor,Seat\n');
  const cursor = Allocation.aggregate([
    { $match: filter },
    { $group: { _id: { student: '$student', room: '$room', seat: '$seatNumber' }, a: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$a' } },
    { $sort: { building: 1, floor: 1, roomName: 1, seatNumber: 1 } },
  ]).collation({ locale: 'en', numericOrdering: true }).allowDiskUse(true).cursor();
  for await (const a of cursor) {
    res.write([a.studentName, a.enrollmentNo, a.course, a.branch, a.semester, a.year, a.building, a.roomName, a.floor === 0 ? 'Ground' : a.floor, a.seatNumber].map(esc).join(',') + '\n');
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

// Builds the full seat grid of a room from that room's allocations
function buildGrid(room, allocs, date, shift) {
  const bySeat = new Map(allocs.map((a) => [a.seatNumber, a]));
  const disabled = new Set(room.disabledSeats);
  const groups = [...new Set(allocs.map((a) => a.group))].sort(naturalCompare);
  const info = new Map();
  for (const a of allocs) {
    if (!info.has(a.group)) info.set(a.group, { label: a.group, count: 0, subjects: new Set() });
    const g = info.get(a.group); g.count++; g.subjects.add(a.subject);
  }
  const seats = [];
  for (let n = 1; n <= room.rows * room.columns; n++) {
    const a = bySeat.get(n);
    const { row, col } = seatToCell(n, room.rows);
    seats.push(a
      ? { seatNumber: n, row, col, state: 'occupied', allocationId: a._id, name: a.studentName, enrollmentNo: a.enrollmentNo, group: a.group, groupIndex: groups.indexOf(a.group), subject: a.subject }
      : { seatNumber: n, row, col, state: disabled.has(n) ? 'disabled' : 'empty' });
  }
  return {
    room: { ...room, capacity: roomCapacity(room) }, date, shift, period: allocs[0]?.period || '', groups, count: allocs.length, seats,
    groupInfo: groups.map((g) => ({ label: g, count: info.get(g).count, subjects: [...info.get(g).subjects] })),
  };
}
const GRID_FIELDS = 'room seatNumber studentName enrollmentNo group subject period';

// Full seat grid of one room for one slot
router.get('/room/:roomId', asyncHandler(async (req, res) => {
  const { date, shift } = slotParams(req.query);
  const room = await Room.findById(oid(req.params.roomId)).lean();
  if (!room) throw new HttpError(404, 'Room not found.');
  const allocs = await Allocation.find({ date, shift, room: room._id }).select(GRID_FIELDS).lean();
  res.json(buildGrid(room, allocs, date, shift));
}));

// Door sheets: one per room + shift for the whole period. A room used in several shifts by the
// same courses in the same seats prints once ("Morning & Afternoon").
router.get('/door-sheets', asyncHandler(async (req, res) => {
  const period = str(req.query.period);
  const q = {};
  if (period) q.period = period; else { const { from, to } = periodParams(req.query); q.date = { $gte: from, $lte: to }; }
  if (str(req.query.room)) q.room = oid(req.query.room);
  const allocs = await Allocation.find(q).select('room seatNumber studentName enrollmentNo group student date shift').lean();
  const byRoom = new Map();
  for (const a of allocs) {
    const rk = String(a.room);
    if (!byRoom.has(rk)) byRoom.set(rk, new Map());
    const shifts = byRoom.get(rk);
    if (!shifts.has(a.shift)) shifts.set(a.shift, { seats: new Map(), dates: new Map(), counts: new Map() });
    const sh = shifts.get(a.shift);
    if (!sh.seats.has(a.seatNumber)) { sh.seats.set(a.seatNumber, a); sh.counts.set(a.group, (sh.counts.get(a.group) || 0) + 1); }
    if (!sh.dates.has(a.group)) sh.dates.set(a.group, new Set());
    sh.dates.get(a.group).add(a.date);
  }
  const rooms = sortRooms(await Room.find({ _id: { $in: [...byRoom.keys()].map(oid) } }).lean());
  const sheets = [];
  for (const room of rooms) {
    const merged = new Map(); // signature -> sheet
    for (const shift of [...byRoom.get(String(room._id)).keys()].sort((a, b) => SHIFT_ORDER[a] - SHIFT_ORDER[b])) {
      const sh = byRoom.get(String(room._id)).get(shift);
      const sig = [...sh.seats.entries()].sort((a, b) => a[0] - b[0]).map(([n, a]) => `${n}:${a.enrollmentNo}`).join(',');
      if (!merged.has(sig)) merged.set(sig, { room, shifts: [], seatsMap: sh.seats, counts: sh.counts, dates: new Map() });
      const m = merged.get(sig);
      m.shifts.push(shift);
      for (const [g, set] of sh.dates) { if (!m.dates.has(g)) m.dates.set(g, new Set()); for (const d of set) m.dates.get(g).add(d); }
    }
    for (const m of merged.values()) {
      const labels = [...m.counts.keys()].sort(naturalCompare);
      const disabled = new Set(room.disabledSeats);
      const seats = [];
      for (let n = 1; n <= room.rows * room.columns; n++) {
        const a = m.seatsMap.get(n);
        const { row, col } = seatToCell(n, room.rows);
        seats.push(a ? { seatNumber: n, row, col, state: 'occupied', name: a.studentName, enrollmentNo: a.enrollmentNo, group: a.group, groupIndex: labels.indexOf(a.group) } : { seatNumber: n, row, col, state: disabled.has(n) ? 'disabled' : 'empty' });
      }
      sheets.push({
        room: { _id: room._id, name: room.name, building: room.building, floor: room.floor, rows: room.rows, columns: room.columns, capacity: roomCapacity(room) },
        shifts: m.shifts, count: m.seatsMap.size, seats,
        groups: labels.map((l) => { const d = [...m.dates.get(l)].sort(); return { label: l, count: m.counts.get(l), from: d[0], to: d[d.length - 1], papers: d.length }; }),
      });
    }
  }
  res.json(sheets);
}));

// Manual override. A student keeps ONE seat for the whole period, so moves, swaps and removals
// apply to every paper that student has at that seat.
const placeFields = (room, n) => { const { row, col } = seatToCell(n, room.rows); return { room: room._id, roomName: room.name, building: room.building, floor: room.floor, seatNumber: n, row, col }; };
const sameSlots = (x, y) => x.length === y.length && x.every((a) => y.some((b) => b.date === a.date && b.shift === a.shift));

router.put('/:id/move', asyncHandler(async (req, res) => {
  const a = await Allocation.findById(oid(req.params.id)).lean();
  if (!a) throw new HttpError(404, 'Allocation not found.');
  const toRoom = req.body.roomId ? await Room.findById(oid(req.body.roomId)).lean() : await Room.findById(a.room).lean();
  if (!toRoom) throw new HttpError(404, 'Room not found.');
  const n = Number(req.body.seatNumber);
  if (!Number.isInteger(n) || n < 1 || n > toRoom.rows * toRoom.columns) throw new HttpError(400, 'Invalid seat.');
  if (toRoom.disabledSeats.includes(n)) throw new HttpError(400, 'That seat is disabled.');
  const here = { student: a.student, room: a.room, seatNumber: a.seatNumber };
  if (String(toRoom._id) === String(a.room) && n === a.seatNumber) return res.json({ message: 'Already in that seat.' });
  const mine = await Allocation.find(here).select('date shift').lean();
  const occ = await Allocation.find({ room: toRoom._id, seatNumber: n, $or: mine.map((m) => ({ date: m.date, shift: m.shift })) }).lean();

  if (!occ.length) {
    await Allocation.updateMany(here, { $set: placeFields(toRoom, n) });
    audit(req, 'SEAT_MOVED', `${a.enrollmentNo} -> ${toRoom.name} seat ${n} (${mine.length} papers)`);
    return res.json({ message: `Moved for all ${mine.length} papers.` });
  }
  if (!req.body.swap) throw new HttpError(409, 'That seat is already taken. Use swap to exchange seats.');
  const owners = new Set(occ.map((o) => String(o.student)));
  if (owners.size !== 1) throw new HttpError(409, 'More than one student uses that seat on different days, so it cannot be swapped. Move to an empty seat instead.');
  const bStudent = occ[0].student;
  const theirHere = { student: bStudent, room: toRoom._id, seatNumber: n };
  const theirs = await Allocation.find(theirHere).select('date shift').lean();
  if (!sameSlots(mine, theirs)) throw new HttpError(409, 'These two students write on different days or shifts, so their seats cannot be swapped. Move to an empty seat instead.');
  const fromRoom = await Room.findById(a.room).lean();
  await Allocation.updateMany(here, { $set: { seatNumber: -1 } }); // park, so the unique seat index is never violated
  try {
    await Allocation.updateMany(theirHere, { $set: placeFields(fromRoom, a.seatNumber) });
    await Allocation.updateMany({ student: a.student, room: a.room, seatNumber: -1 }, { $set: placeFields(toRoom, n) });
  } catch (e) {
    await Allocation.updateMany({ student: a.student, room: a.room, seatNumber: -1 }, { $set: { seatNumber: a.seatNumber } }).catch(() => {});
    throw e;
  }
  audit(req, 'SEAT_SWAPPED', `${a.enrollmentNo} <-> ${occ[0].enrollmentNo} (${mine.length} papers)`);
  res.json({ message: 'Seats swapped for the whole period.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const a = await Allocation.findById(oid(req.params.id)).lean();
  if (!a) throw new HttpError(404, 'Allocation not found.');
  const r = await Allocation.deleteMany({ student: a.student, room: a.room, seatNumber: a.seatNumber });
  audit(req, 'ALLOCATION_REMOVED', `${a.enrollmentNo} (${r.deletedCount} papers)`);
  res.json({ message: 'Removed.', removed: r.deletedCount });
}));

// ---------------------------------------------------------------------------
// File-based Allocation:
// 1. Auto-allocate from uploaded datesheet file (Excel / CSV)
// 2. Direct import of seating plan (MUR, Room, Seat)
// ---------------------------------------------------------------------------

router.post('/upload-datesheet', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  let raw;
  try { raw = ds.readRows(req.file.buffer); } catch (e) { throw new HttpError(400, e.message); }
  if (!raw.length) throw new HttpError(400, 'The file has no exam papers in it.');

  const rows = ds.toRows(raw);
  const title = (req.body.examName ? str(req.body.examName) : path.basename(req.file.originalname, path.extname(req.file.originalname))).replace(/[_]+/g, ' ').trim() || 'Exam Session';

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

  const matcher = ds.buildMatcher(pairs);
  const cleanRows = rows.map((r) => ({
    row: Number(r.row) || 0, course: str(r.course), branch: str(r.branch), year: String(r.year ?? '').trim(), semester: String(r.semester ?? '').trim(),
    code: str(r.code), subject: str(r.subject), date: str(r.date), shift: str(r.shift),
    durationMin: Number.isFinite(Number(r.durationMin)) && Number(r.durationMin) > 0 ? Number(r.durationMin) : null,
  }));
  const plan = ds.buildPlan(cleanRows, matcher, counts);

  if (!plan.exams.length) throw new HttpError(422, 'No valid exam papers found in the datesheet file.');

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

  const allDates = [];
  for (const ex of plan.exams) for (const en of ex.entries) allDates.push(en.date);
  allDates.sort();
  const from = allDates[0];
  const to = allDates[allDates.length - 1];

  const dryRun = req.body.dryRun === 'true' || req.body.dryRun === true;

  // Create/update the exams
  let createdExams = 0, updatedExams = 0;
  for (const ex of plan.exams) {
    const name = `${title} · ${ex.course} Y${ex.year}${ex.semester ? ` S${ex.semester}` : ''}`.slice(0, 120);
    const dates = ex.entries.map((e) => e.date).sort();
    const existing = await Exam.findOne({ name, course: ex.course, year: ex.year, semester: ex.semester || null });
    const entries = ex.entries.map((e) => ({
      date: e.date, shift: e.shift, subject: e.subject, branch: e.branch || '', code: e.code || '', durationMin: e.durationMin ?? null,
    }));
    if (existing) {
      existing.entries = entries;
      existing.startDate = dates[0] || from;
      existing.endDate = dates[dates.length - 1] || to;
      await existing.save();
      updatedExams++;
    } else {
      await Exam.create({
        name, course: ex.course, year: ex.year, semester: ex.semester || null,
        startDate: dates[0] || from, endDate: dates[dates.length - 1] || to, entries,
      });
      createdExams++;
    }
  }

  // Parse options if provided
  let roomIds = null;
  if (req.body.roomIds) {
    try { roomIds = typeof req.body.roomIds === 'string' ? JSON.parse(req.body.roomIds) : req.body.roomIds; } catch {}
  }
  let assignments = [];
  if (req.body.assignments) {
    try { assignments = typeof req.body.assignments === 'string' ? JSON.parse(req.body.assignments) : req.body.assignments; } catch {}
  }

  const allocResult = await runPeriod({
    from,
    to,
    roomIds,
    dryRun,
    assignments,
    useFullRoom: req.body.useFullRoom === 'true' || req.body.useFullRoom === true,
    allowPartial: req.body.allowPartial === 'true' || req.body.allowPartial === true,
  });

  if (!dryRun && allocResult.saved) {
    audit(req, 'DATESHEET_ALLOCATED', `${title}: ${from} to ${to}: ${allocResult.seated} seated in ${allocResult.roomsNeeded} rooms`);
  }

  res.json({
    from,
    to,
    examTitle: title,
    examsCount: plan.exams.length,
    papersCount: allDates.length,
    createdExams,
    updatedExams,
    classPreview,
    ...allocResult,
  });
}));

const SEATING_ALIASES = {
  enrollmentNo: ['mur', 'murno', 'enrollmentno', 'enrollment', 'rollno', 'studentmur', 'studentenrollmentno'],
  room: ['room', 'roomname', 'hall', 'roomno', 'buildingroom'],
  seatNumber: ['seat', 'seatnumber', 'seatno'],
  date: ['date', 'examdate'],
  shift: ['shift', 'session', 'slot'],
  subject: ['subject', 'subjectname', 'paper'],
};

router.post('/import-seating', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  let wb, rows;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  } catch {
    throw new HttpError(400, 'Could not read this file. Upload a .csv, .xlsx or .xls file.');
  }
  if (!rows.length) throw new HttpError(400, 'The file has no rows.');
  if (rows.length > 20000) throw new HttpError(400, 'Maximum 20,000 rows per upload.');

  const [allStudents, allRooms, allExams] = await Promise.all([
    Student.find({ status: 'active' }).select('name enrollmentNo course branch year semester').lean(),
    Room.find({ isActive: true }).lean(),
    Exam.find().lean(),
  ]);

  const studentByMur = new Map();
  for (const s of allStudents) {
    studentByMur.set(normEnr(s.enrollmentNo), s);
  }

  const roomByName = new Map();
  for (const r of allRooms) {
    roomByName.set(String(r.name).trim().toLowerCase(), r);
    roomByName.set(`${String(r.building).trim()} · ${String(r.name).trim()}`.toLowerCase(), r);
    roomByName.set(`${String(r.building).trim()} ${String(r.name).trim()}`.toLowerCase(), r);
  }

  const errors = [];
  const validAllocs = [];

  rows.forEach((raw, idx) => {
    const rowNo = idx + 2;
    const flat = {};
    for (const k of Object.keys(raw)) flat[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = raw[k];

    const getVal = (aliases) => {
      const key = aliases.find((a) => flat[a] !== undefined && String(flat[a]).trim() !== '');
      return key ? String(flat[key]).trim() : '';
    };

    const mur = normEnr(getVal(SEATING_ALIASES.enrollmentNo));
    const roomStr = getVal(SEATING_ALIASES.room);
    const seatVal = parseInt(getVal(SEATING_ALIASES.seatNumber), 10);
    const dateVal = getVal(SEATING_ALIASES.date);
    const shiftVal = getVal(SEATING_ALIASES.shift);
    const subjectVal = getVal(SEATING_ALIASES.subject);

    if (!mur) { errors.push({ row: rowNo, message: 'Missing MUR / Enrollment Number' }); return; }
    if (!roomStr) { errors.push({ row: rowNo, message: 'Missing Room name' }); return; }
    if (!Number.isInteger(seatVal) || seatVal < 1) { errors.push({ row: rowNo, message: 'Invalid Seat Number' }); return; }

    const student = studentByMur.get(mur);
    if (!student) { errors.push({ row: rowNo, message: `Student with MUR "${mur}" not found or inactive` }); return; }

    const room = roomByName.get(roomStr.toLowerCase());
    if (!room) { errors.push({ row: rowNo, message: `Room "${roomStr}" not found` }); return; }

    if (seatVal > room.rows * room.columns) {
      errors.push({ row: rowNo, message: `Seat ${seatVal} exceeds capacity of ${room.name} (${room.rows * room.columns})` });
      return;
    }
    if ((room.disabledSeats || []).includes(seatVal)) {
      errors.push({ row: rowNo, message: `Seat ${seatVal} is disabled in ${room.name}` });
      return;
    }

    const { row, col } = seatToCell(seatVal, room.rows);
    validAllocs.push({
      student,
      room,
      seatNumber: seatVal,
      row,
      col,
      date: isDate(dateVal) ? dateVal : '',
      shift: SHIFTS.includes(shiftVal) ? shiftVal : '',
      subject: subjectVal,
      rowNo,
    });
  });

  if (!validAllocs.length) {
    throw new HttpError(422, 'No valid seating assignments found in file.', { errors: errors.slice(0, 50) });
  }

  const docs = [];
  for (const v of validAllocs) {
    const s = v.student;
    const r = v.room;
    const group = groupLabel(s);

    if (v.date && v.shift) {
      docs.push({
        date: v.date,
        shift: v.shift,
        shiftOrder: SHIFT_ORDER[v.shift] ?? 0,
        exam: allExams[0]?._id || new mongoose.Types.ObjectId(),
        entryId: new mongoose.Types.ObjectId(),
        subject: v.subject || 'Exam',
        period: '',
        student: s._id,
        studentName: s.name,
        enrollmentNo: s.enrollmentNo,
        course: s.course,
        branch: s.branch,
        year: s.year,
        semester: s.semester,
        group,
        room: r._id,
        roomName: r.name,
        building: r.building,
        floor: r.floor,
        seatNumber: v.seatNumber,
        row: v.row,
        col: v.col,
      });
    } else {
      let foundPapers = 0;
      for (const ex of allExams) {
        if (ex.course !== s.course || ex.year !== s.year) continue;
        if (ex.semester && ex.semester !== s.semester) continue;
        for (const en of ex.entries) {
          if (en.branch && en.branch !== s.branch) continue;
          foundPapers++;
          docs.push({
            date: en.date,
            shift: en.shift,
            shiftOrder: SHIFT_ORDER[en.shift] ?? 0,
            exam: ex._id,
            entryId: en._id,
            subject: en.subject,
            period: `${ex.startDate}_${ex.endDate}`,
            student: s._id,
            studentName: s.name,
            enrollmentNo: s.enrollmentNo,
            course: s.course,
            branch: s.branch,
            year: s.year,
            semester: s.semester,
            group,
            room: r._id,
            roomName: r.name,
            building: r.building,
            floor: r.floor,
            seatNumber: v.seatNumber,
            row: v.row,
            col: v.col,
          });
        }
      }
      if (!foundPapers) {
        docs.push({
          date: new Date().toISOString().slice(0, 10),
          shift: 'Morning',
          shiftOrder: 0,
          exam: new mongoose.Types.ObjectId(),
          entryId: new mongoose.Types.ObjectId(),
          subject: 'Examination',
          period: 'imported',
          student: s._id,
          studentName: s.name,
          enrollmentNo: s.enrollmentNo,
          course: s.course,
          branch: s.branch,
          year: s.year,
          semester: s.semester,
          group,
          room: r._id,
          roomName: r.name,
          building: r.building,
          floor: r.floor,
          seatNumber: v.seatNumber,
          row: v.row,
          col: v.col,
        });
      }
    }
  }

  let inserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK);
    const ops = chunk.map((d) => ({
      updateOne: {
        filter: { date: d.date, shift: d.shift, student: d.student },
        update: { $set: d },
        upsert: true,
      },
    }));
    const resWrite = await Allocation.bulkWrite(ops, { ordered: false });
    inserted += (resWrite.upsertedCount || 0) + (resWrite.modifiedCount || 0);
  }

  audit(req, 'SEATING_IMPORTED', `${docs.length} seat records imported from file`);
  res.json({
    totalRows: rows.length,
    validRows: validAllocs.length,
    seatRecordsCreated: docs.length,
    errorsCount: errors.length,
    errors: errors.slice(0, 50),
  });
}));

router.get('/seating-template', (req, res) => {
  const isCsv = req.query.format === 'csv';
  const sample = [
    ['MUR', 'Student Name', 'Room', 'Seat Number', 'Date', 'Shift'],
    ['MUR000001', 'Aarav Sharma', 'Room 101', 1, '2026-11-20', 'Morning'],
    ['MUR000002', 'Riya Verma', 'Room 101', 2, '2026-11-20', 'Morning'],
    ['MUR000003', 'Vivaan Gupta', 'Room 101', 11, '2026-11-20', 'Morning'],
  ];
  if (isCsv) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="seating-template.csv"');
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    return res.send(sample.map((r) => r.map(q).join(',')).join('\n') + '\n');
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Seating');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="seating-template.xlsx"');
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

module.exports = router;
