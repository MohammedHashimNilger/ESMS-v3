import { createPortal } from 'react-dom';
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
    const tip = info?.name ? `Seat ${n} · ${info.name} · ${info.enrollmentNo}` : n === mySeat ? `Your seat (${n})` : `Seat ${n}`;
    cells.push(
      <button
        type="button" key={n} title={tip} aria-label={tip} disabled={!clickable}
        className={`seat ${cls}${clickable ? ' clickable' : ''}${selected === n ? ' sel' : ''}`}
        onClick={clickable ? () => onSeatClick(n, info) : undefined}
      >
        <span>{n}</span>
        {showNames && info?.name && <><small className="nm">{info.name}</small><small className="mu">{info.enrollmentNo}</small></>}
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

const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const rangeLabel = (g) => (g.from === g.to ? fmtD(g.from) : `${fmtD(g.from)} – ${fmtD(g.to)}`);

/**
 * Door sheet for one room + shift for the WHOLE exam period: every seat shows
 * seat number, student name and MUR; the legend gives each course's date range.
 * Meant to be stuck on the room door.
 */
export function DoorSheet({ sheet }) {
  const { room, seats, shifts, groups, count } = sheet;
  const cols = room.columns;
  const dens = cols <= 6 ? 1 : cols <= 10 ? 2 : cols <= 14 ? 3 : 4;
  const floor = room.floor === 0 ? 'Ground floor' : `Floor ${room.floor}`;
  return (
    <section className={`sheet dens-${dens}`}>
      <header className="sheet-head">
        <div>
          <h1>{room.name} <small>{room.building} · {floor}</small></h1>
          <div className="sheet-sub">{shifts.join(' & ')} {shifts.length > 1 ? 'shifts' : 'shift'}</div>
        </div>
        <div className="sheet-count"><b>{count}</b> students</div>
      </header>
      <div className="sheet-board">Front · Board</div>
      <div className="sheet-grid" style={{ '--rows': room.rows, '--cols': cols }}>
        {seats.map((s) => (
          <div key={s.seatNumber} className={`sc ${s.state}${s.state === 'occupied' ? ` g${(s.groupIndex ?? 0) % 6}` : ''}`}>
            <b>{s.seatNumber}</b>
            {s.state === 'occupied' ? <><span className="n">{s.name}</span><i>{s.enrollmentNo}</i></> : s.state === 'disabled' ? <em>Not in use</em> : null}
          </div>
        ))}
      </div>
      <footer className="sheet-foot">
        <div className="sheet-legend">
          {groups.map((g, i) => <span key={g.label}><u className={`g${i % 6}`} /><b>{g.label}</b> · {rangeLabel(g)}</span>)}
        </div>
      </footer>
    </section>
  );
}

/** Renders door sheets off-screen and opens the print dialog; calls onDone afterwards. */
export function PrintDoorSheets({ sheets, onDone }) {
  React.useEffect(() => {
    document.body.classList.add('printing-sheets');
    const done = () => { document.body.classList.remove('printing-sheets'); onDone(); };
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 250);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); document.body.classList.remove('printing-sheets'); };
  }, [sheets]); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(<div className="print-sheets">{sheets.map((g, i) => <DoorSheet key={g.room._id + i} sheet={g} />)}</div>, document.body);
}
