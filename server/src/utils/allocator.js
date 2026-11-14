const { seatToCell, naturalCompare } = require('./common');

/**
 * Pure seat-allocation algorithm (no database), used for a WHOLE exam period.
 *
 * Every student gets ONE room + seat that they keep for every paper.
 *
 * Rules:
 *  - group : one class = course + branch + year + semester.
 *  - Each room has odd columns (1,3,5..) and even columns (2,4,6..).
 *  - Adjacent columns belong to different groups in the same shift (anti-cheating).
 *  - A room can hold multiple groups (2, 3, 4, 5, 6, 7, 8+):
 *    odd columns can be shared by multiple groups (Col 1: G1, Col 3: G3, Col 5: G5, etc.),
 *    and even columns can be shared by multiple groups (Col 2: G2, Col 4: G4, Col 6: G6, etc.).
 *  - Two groups CLASH if they write in a common shift (Morning / Afternoon / Evening).
 *    Groups that never share a shift may reuse the same physical seats.
 *  - In automatic allocation, a group uses one half per room (odd or even) to avoid sitting next
 *    to itself in adjacent columns, unless opts.useFullRoom is enabled.
 *
 * opts.groupShifts : Map<group, Set<shift>>
 * opts.assignments : [{ roomId, groups: [label1, label2, ...] }]
 * opts.useFullRoom : lets leftover students use empty columns if rooms run short
 *
 * students: [{ _id, enrollmentNo, group }]
 * rooms:    [{ _id, rows, columns, disabledSeats }] (in preferred order)
 */
function allocate(students, rooms, opts = {}) {
  const { assignments = [], useFullRoom = false, groupShifts = null } = opts;

  const byGroup = new Map();
  for (const s of students) {
    let list = byGroup.get(s.group);
    if (!list) byGroup.set(s.group, (list = []));
    list.push(s);
  }
  const shiftsOf = (g) => (groupShifts && groupShifts.get(g)) || new Set(['*']);
  const groups = [...byGroup.entries()].map(([name, list]) => ({
    name,
    shifts: shiftsOf(name),
    list: list.sort((a, b) => naturalCompare(a.enrollmentNo, b.enrollmentNo)),
    idx: 0,
  }));
  // Constrained shifts first (more clash constraints), then natural name
  groups.sort((a, b) => b.shifts.size - a.shifts.size || naturalCompare(a.name, b.name));
  const byName = new Map(groups.map((g) => [g.name, g]));
  const left = (g) => g.list.length - g.idx;

  const halves = rooms.map((room) => {
    const disabled = new Set(room.disabledSeats || []);
    const mk = (parity) => {
      const seats = [];
      for (let col = parity; col <= room.columns; col += 2) {
        for (let row = 1; row <= room.rows; row++) {
          const n = (col - 1) * room.rows + row;
          if (!disabled.has(n)) seats.push(n);
        }
      }
      return { room, parity, seats, seatShifts: new Map(), groups: new Set() };
    };
    return { room, odd: mk(1), even: mk(2), manual: false };
  });

  const freeSeatsFor = (h, g) => {
    return h.seats.filter((n) => {
      const used = h.seatShifts.get(n);
      if (!used) return true;
      for (const s of g.shifts) {
        if (used.has(s)) return false;
      }
      return true;
    });
  };

  const placements = [];
  const roomsUsed = new Set();
  const warnings = [];

  const take = (g, h, manual) => {
    let placed = 0;
    const remainingSeats = [];
    for (const n of h.seats) {
      const used = h.seatShifts.get(n);
      let canUse = true;
      if (used) {
        for (const s of g.shifts) {
          if (used.has(s)) { canUse = false; break; }
        }
      }
      if (canUse && left(g) > 0) {
        const student = g.list[g.idx++];
        const { row, col } = seatToCell(n, h.room.rows);
        placements.push({ student, room: h.room, seatNumber: n, row, col, manual: !!manual });
        placed++;

        if (!h.seatShifts.has(n)) h.seatShifts.set(n, new Set());
        for (const s of g.shifts) h.seatShifts.get(n).add(s);
        h.groups.add(g.name);
        roomsUsed.add(h.room);
      } else {
        remainingSeats.push(n);
      }
    }
    h.seats = remainingSeats;
    return placed;
  };

  // Phase 1: Manual assignments
  const manualRooms = new Set();
  const assignByRoom = new Map();
  for (const a of assignments) {
    const names = [...new Set((a.groups || []).filter((x) => byName.has(x)))];
    if (names.length) assignByRoom.set(String(a.roomId), names);
  }
  for (const H of halves) {
    const names = assignByRoom.get(String(H.room._id));
    if (!names) continue;
    H.manual = true;
    names.forEach((name, i) => {
      const g = byName.get(name);
      if (!left(g)) return;
      const h = i % 2 === 0 ? H.odd : H.even;
      if (take(g, h, true)) manualRooms.add(H.room);
    });
  }

  // Phase 2: Automatic allocation
  // A group uses one half per room (odd or even) to avoid sitting in adjacent columns of the same room.
  const sameRoomUsed = new Map(); // `${group}|${roomId}` -> 'odd' | 'even'
  const pass = (relaxed) => {
    for (const g of groups) {
      if (!left(g)) continue;
      for (const H of halves) {
        if (!left(g)) break;
        if (H.manual) continue;
        const key = `${g.name}|${H.room._id}`;
        const prevHalf = sameRoomUsed.get(key);

        const candidates = [];
        if (relaxed) {
          candidates.push(H.odd, H.even);
        } else if (!prevHalf) {
          candidates.push(H.odd, H.even);
        } else if (prevHalf === 'odd') {
          candidates.push(H.odd);
        } else {
          candidates.push(H.even);
        }

        for (const h of candidates) {
          if (!left(g)) break;
          if (freeSeatsFor(h, g).length === 0) continue;
          if (take(g, h, false)) {
            if (!sameRoomUsed.has(key)) {
              sameRoomUsed.set(key, h === H.odd ? 'odd' : 'even');
            }
            if (!relaxed) break;
          }
        }
      }
    }
  };

  pass(false);
  if (useFullRoom && groups.some(left)) pass(true);

  const unallocated = [];
  for (const g of groups) for (let i = g.idx; i < g.list.length; i++) unallocated.push(g.list[i]);

  return { placements, unallocated, roomsUsed: [...roomsUsed], manualRooms: [...manualRooms], warnings };
}

module.exports = { allocate };
