import React from 'react';

/**
 * One grid for every use:
 *  - admin seating view   : pass `seats` (from API) + showNames
 *  - student view         : pass `occupied` (numbers only) + `mySeat`
 *  - room editor          : pass `disabled` + onSeatClick to toggle seats
 * Seat numbers run DOWN each column (1..rows in column 1, then column 2 ...).
 */
export default function RoomGrid({ rows, columns, disabled = [], seats, occupied = [], mySeat, selected, onSeatClick, showNames = false, board = true }) {
  const dis = new Set(disabled);
  const occ = new Set(occupied);
  const bySeat = seats ? new Map(seats.map((s) => [s.seatNumber, s])) : null;

  const cells = [];
  for (let n = 1; n <= rows * columns; n++) {
    const info = bySeat?.get(n);
    let cls = 'empty';
    if (n === mySeat) cls = 'me';
    else if (info?.state === 'occupied') cls = `occ g${(info.groupIndex ?? 0) % 6}`;
    else if (info?.state === 'disabled' || dis.has(n)) cls = 'disabled';
    else if (occ.has(n)) cls = 'occ';
    const clickable = !!onSeatClick;
    const first = info?.name ? info.name.split(' ')[0] : '';
    const tip = info?.name ? `Seat ${n} · ${info.name} · ${info.enrollmentNo}` : n === mySeat ? `Your seat (${n})` : `Seat ${n}`;
    cells.push(
      <button
        type="button" key={n} title={tip} aria-label={tip} disabled={!clickable}
        className={`seat ${cls}${clickable ? ' clickable' : ''}${selected === n ? ' sel' : ''}`}
        onClick={clickable ? () => onSeatClick(n, info) : undefined}
      >
        <span>{n}</span>
        {showNames && first && <small>{first}</small>}
      </button>
    );
  }
  const vars = { '--rows': rows, '--cols': columns };
  return (
    <div className={`rg${showNames ? ' names' : ''}`} style={vars}>
      {board && <div className="rg-board">Front · Board</div>}
      <div className="rg-scroll">
        <div className="rg-cols">{Array.from({ length: columns }, (_, i) => <span key={i}>C{i + 1}</span>)}</div>
        <div className="rg-seats">{cells}</div>
      </div>
    </div>
  );
}

export const GROUP_COLORS = ['var(--g0)', 'var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)', 'var(--g5)'];

export function GroupLegend({ groups }) {
  if (!groups?.length) return null;
  return (
    <div className="legend">
      {groups.map((g, i) => <span key={g}><i style={{ background: GROUP_COLORS[i % 6] }} />{g}</span>)}
      <span><i style={{ background: '#fafbfd' }} />Empty</span>
      <span><i style={{ background: '#e8ebf1' }} />Disabled</span>
    </div>
  );
}
