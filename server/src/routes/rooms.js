const router = require('express').Router();
const Room = require('../models/Room');
const Allocation = require('../models/Allocation');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect } = require('../middleware/auth');
const { str, escapeRegex, toInt } = require('../utils/common');

router.use(protect('admin'));

function parseRoom(b) {
  const rows = toInt(b.rows, 1, 40, 'Rows');
  const columns = toInt(b.columns, 1, 40, 'Columns');
  const total = rows * columns;
  const disabled = [...new Set((Array.isArray(b.disabledSeats) ? b.disabledSeats : []).map(Number))];
  if (disabled.some((n) => !Number.isInteger(n) || n < 1 || n > total)) throw new HttpError(400, 'Disabled seats must be valid seat numbers.');
  const data = {
    name: str(b.name), building: str(b.building), floor: toInt(b.floor ?? 0, 0, 30, 'Floor'),
    rows, columns, disabledSeats: disabled.sort((a, b2) => a - b2), isActive: b.isActive !== false,
  };
  if (!data.name || !data.building) throw new HttpError(400, 'Room name and building are required.');
  if (disabled.length >= total) throw new HttpError(400, 'A room needs at least one usable seat.');
  return data;
}

router.get('/', asyncHandler(async (req, res) => {
  const f = {};
  const search = str(req.query.search);
  if (search) { const r = new RegExp(escapeRegex(search), 'i'); f.$or = [{ name: r }, { building: r }]; }
  const rooms = await Room.find(f).sort({ building: 1, floor: 1, name: 1 }).lean({ virtuals: true });
  res.json(rooms.map((r) => ({ ...r, capacity: r.rows * r.columns - r.disabledSeats.length })));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) throw new HttpError(404, 'Room not found.');
  res.json(room);
}));

router.post('/', asyncHandler(async (req, res) => {
  const room = await Room.create(parseRoom(req.body));
  audit(req, 'ROOM_CREATED', `${room.building} ${room.name}`);
  res.status(201).json(room);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) throw new HttpError(404, 'Room not found.');
  const data = parseRoom(req.body);

  const inUse = await Allocation.exists({ room: room._id });
  if (inUse) {
    if (data.rows !== room.rows || data.columns !== room.columns) {
      throw new HttpError(409, 'This room has seating allocations. Clear them before changing its rows/columns.');
    }
    const usedDisabled = await Allocation.exists({ room: room._id, seatNumber: { $in: data.disabledSeats } });
    if (usedDisabled) throw new HttpError(409, 'A student is seated on a seat you are trying to disable. Clear or move them first.');
  }
  Object.assign(room, data);
  await room.save();
  await Allocation.updateMany({ room: room._id }, { $set: { roomName: room.name, building: room.building, floor: room.floor } });
  audit(req, 'ROOM_UPDATED', `${room.building} ${room.name}`);
  res.json(room);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (await Allocation.exists({ room: req.params.id })) throw new HttpError(409, 'This room has seating allocations. Clear them before deleting the room.');
  const room = await Room.findByIdAndDelete(req.params.id);
  if (!room) throw new HttpError(404, 'Room not found.');
  audit(req, 'ROOM_DELETED', `${room.building} ${room.name}`);
  res.json({ message: 'Room deleted.' });
}));

module.exports = router;
