const assert = require('assert');
const { allocate } = require('./allocator');

// 5,000 students, 4 classes, 70 rooms of 10 rows x 8 cols
const mk = (g, n, p) => Array.from({ length: n }, (_, i) => ({ _id: `${p}${i}`, enrollmentNo: `${p}${String(i).padStart(5, '0')}`, group: g }));
const students = [...mk('B.Tech CSE Y1 S1', 1500, 'A'), ...mk('B.Tech ECE Y1 S1', 1300, 'B'), ...mk('B.Tech ME Y1 S1', 1200, 'C'), ...mk('BCA CS Y1 S1', 1000, 'D')];
const rooms = Array.from({ length: 70 }, (_, i) => ({ _id: `R${i}`, rows: 10, columns: 8, disabledSeats: i % 5 === 0 ? [3, 4] : [] }));

console.time('allocate 5000');
const r = allocate(students, rooms);
console.timeEnd('allocate 5000');

assert.strictEqual(r.unallocated.length, 0, 'everyone seated');
assert.strictEqual(r.placements.length, 5000);
const seen = new Set();
const perRoom = new Map();
const parity = new Map();
for (const p of r.placements) {
  const key = p.room._id + ':' + p.seatNumber;
  assert(!seen.has(key), 'no double-booked seat'); seen.add(key);
  assert(!(p.room.disabledSeats || []).includes(p.seatNumber), 'no disabled seat used');
  if (!perRoom.has(p.room._id)) perRoom.set(p.room._id, new Set());
  perRoom.get(p.room._id).add(p.student.group);
  assert.strictEqual(p.row, ((p.seatNumber - 1) % 10) + 1);
  const k = p.room._id + ':' + (p.col % 2);
  if (!parity.has(k)) parity.set(k, p.student.group);
  assert.strictEqual(parity.get(k), p.student.group, 'odd/even columns hold one group each');
}
for (const [room, groups] of perRoom) assert(groups.size <= 2, `room ${room} has ${groups.size} groups`);
console.log('rooms used:', r.roomsUsed.length, '- all assertions passed');

// strict rule: one group only -> even columns empty
const one = allocate(mk('X', 30, 'X'), [{ _id: 'R', rows: 5, columns: 4, disabledSeats: [] }]);
assert.strictEqual(one.placements.length, 10);
assert(one.placements.every((p) => p.col % 2 === 1));
assert.strictEqual(one.unallocated.length, 20);
console.log('strict single-group rule ok');
