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
for (const p of r.placements) {
  const key = p.room._id + ':' + p.seatNumber;
  assert(!seen.has(key), 'no double-booked seat'); seen.add(key);
  assert(!(p.room.disabledSeats || []).includes(p.seatNumber), 'no disabled seat used');
  if (!perRoom.has(p.room._id)) perRoom.set(p.room._id, new Set());
  perRoom.get(p.room._id).add(p.student.group);
  assert.strictEqual(p.row, ((p.seatNumber - 1) % 10) + 1);
}
console.log('rooms used:', r.roomsUsed.length, '- 5000 students test passed');

// strict rule: one group only -> even columns empty
const one = allocate(mk('X', 30, 'X'), [{ _id: 'R', rows: 5, columns: 4, disabledSeats: [] }]);
assert.strictEqual(one.placements.length, 10);
assert(one.placements.every((p) => p.col % 2 === 1));
assert.strictEqual(one.unallocated.length, 20);
console.log('strict single-group rule ok');

// manual assignment: pin class Y and Z to room R2, rest automatic
{
  const st = [...mk('X', 8, 'X'), ...mk('Y', 8, 'Y'), ...mk('Z', 8, 'Z')];
  const rm = [{ _id: 'R0', rows: 4, columns: 4, disabledSeats: [] }, { _id: 'R1', rows: 4, columns: 4, disabledSeats: [] }, { _id: 'R2', rows: 4, columns: 4, disabledSeats: [] }];
  const r2 = allocate(st, rm, { assignments: [{ roomId: 'R2', groups: ['Z', 'Y'] }] });
  assert.strictEqual(r2.unallocated.length, 0);
  const inRoom = (id) => new Set(r2.placements.filter((p) => p.room._id === id).map((p) => p.student.group));
  assert.deepStrictEqual([...inRoom('R2')].sort(), ['Y', 'Z']);
  assert(!r2.placements.some((p) => p.room._id === 'R0' && p.student.group === 'Z'), 'Z stays in its pinned room');

  // overflow of a pinned class goes to automatic rooms
  const r3 = allocate(mk('Q', 20, 'Q'), rm, { assignments: [{ roomId: 'R2', groups: ['Q'] }] });
  assert.strictEqual(r3.unallocated.length, 0);
  assert.strictEqual(r3.placements.filter((p) => p.room._id === 'R2').length, 8);

  // full-room option
  const r4 = allocate(mk('F', 16, 'F'), [rm[0]], { useFullRoom: true });
  assert.strictEqual(r4.placements.length, 16);
  console.log('manual assignment + full room ok');
}

// period model: groups that never share a shift reuse the same seats; clashing groups never do
{
  const st = [...mk('M1', 8, 'a'), ...mk('M2', 8, 'b'), ...mk('A1', 8, 'c'), ...mk('MA', 8, 'd')];
  const gs = new Map([['M1', new Set(['Morning'])], ['M2', new Set(['Morning'])], ['A1', new Set(['Afternoon'])], ['MA', new Set(['Morning', 'Afternoon'])]]);
  const rm = [{ _id: 'R0', rows: 4, columns: 4, disabledSeats: [] }, { _id: 'R1', rows: 4, columns: 4, disabledSeats: [] }, { _id: 'R2', rows: 4, columns: 4, disabledSeats: [] }];
  const r = allocate(st, rm, { groupShifts: gs });
  assert.strictEqual(r.unallocated.length, 0);
  const seatKey = (p) => p.room._id + ':' + p.seatNumber;
  for (const shift of ['Morning', 'Afternoon']) {
    const seen = new Set();
    for (const p of r.placements) { if (!gs.get(p.student.group).has(shift)) continue; assert(!seen.has(seatKey(p)), `seat clash in ${shift}`); seen.add(seatKey(p)); }
  }
  // each student has exactly one seat
  assert.strictEqual(new Set(r.placements.map((p) => p.student._id)).size, r.placements.length);
  console.log('period model ok, rooms used:', r.roomsUsed.length);
}

// multi-course room test: more than 2 courses in a room
{
  const classes = ['CSE', 'AIML', 'AIDS', 'BCA', 'MCA', 'BSC'];
  const st = classes.flatMap((c, i) => mk(c, 10, 'S' + i));
  const rm = [{ _id: 'BigRoom', rows: 10, columns: 8, disabledSeats: [] }];
  const rMulti = allocate(st, rm);
  assert.strictEqual(rMulti.unallocated.length, 0, 'all 60 students seated in 1 room');
  const inBigRoom = new Set(rMulti.placements.map(p => p.student.group));
  assert.strictEqual(inBigRoom.size, 6, 'room holds all 6 courses');
  console.log('multi-course in one room ok:', inBigRoom.size, 'courses in 1 room');
}
