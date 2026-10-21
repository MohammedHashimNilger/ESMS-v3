const { seatToCell, naturalCompare } = require('./common');

/**
 * Pure seat-allocation algorithm (no database) so it is fast and unit-testable.
 *
 * Rules
 *  - A "group" is one class: course + branch + year + semester.
 *  - Groups are sorted so related classes sit next to each other, and rooms are
 *    consumed in order, so one class occupies neighbouring rooms.
 *  - Every room holds at most TWO groups: group A in odd columns (1,3,5...),
 *    group B in even columns (2,4,6...).
 *  - Strict rule: if only one group is left, the even columns stay empty.
 *  - Seat numbers run down each column.
 *
 * students: [{ _id, enrollmentNo, group }]
 * rooms:    [{ _id, rows, columns, disabledSeats }]  (already in preferred order)
 * Complexity: O(S log S + R * seatsPerRoom)
 */
function allocate(students, rooms) {
  const byGroup = new Map();
  for (const s of students) {
    let list = byGroup.get(s.group);
    if (!list) byGroup.set(s.group, (list = []));
    list.push(s);
  }
  const groups = [...byGroup.entries()]
    .sort((a, b) => naturalCompare(a[0], b[0]))
    .map(([name, list]) => ({ name, list: list.sort((a, b) => naturalCompare(a.enrollmentNo, b.enrollmentNo)), idx: 0 }));

  const placements = [];
  const roomsUsed = [];

  const fill = (group, seats, room) => {
    let placed = 0;
    for (const n of seats) {
      if (group.idx >= group.list.length) break;
      const student = group.list[group.idx++];
      const { row, col } = seatToCell(n, room.rows);
      placements.push({ student, room, seatNumber: n, row, col });
      placed++;
    }
    return placed;
  };

  let firstActive = 0; // skip exhausted groups cheaply
  for (const room of rooms) {
    while (firstActive < groups.length && groups[firstActive].idx >= groups[firstActive].list.length) firstActive++;
    if (firstActive >= groups.length) break;

    const A = groups[firstActive];
    let B = null;
    for (let i = firstActive + 1; i < groups.length; i++) {
      if (groups[i].idx < groups[i].list.length) { B = groups[i]; break; }
    }

    const disabled = new Set(room.disabledSeats || []);
    const odd = [];
    const even = [];
    for (let col = 1; col <= room.columns; col++) {
      const target = col % 2 === 1 ? odd : even;
      for (let row = 1; row <= room.rows; row++) {
        const n = (col - 1) * room.rows + row;
        if (!disabled.has(n)) target.push(n);
      }
    }
    let placed = fill(A, odd, room);
    if (B) placed += fill(B, even, room);
    if (placed > 0) roomsUsed.push(room);
  }

  const unallocated = [];
  for (const g of groups) for (let i = g.idx; i < g.list.length; i++) unallocated.push(g.list[i]);

  return { placements, unallocated, roomsUsed };
}

module.exports = { allocate };
