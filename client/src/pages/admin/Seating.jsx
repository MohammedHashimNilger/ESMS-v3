import React, { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import RoomGrid, { GroupLegend } from '../../components/RoomGrid.jsx';
import { Field, PageHead, Pager, useToast, useDebounced, todayStr, SHIFTS, floorLabel } from '../../components/ui.jsx';

export default function Seating() {
  const toast = useToast();
  const [tab, setTab] = useState('students');
  const [f, setF] = useState({ date: todayStr(), shift: '', course: '', branch: '', year: '', semester: '', search: '' });
  const [opts, setOpts] = useState({ courses: [], branches: [], years: [], semesters: [] });
  const search = useDebounced(f.search);
  useEffect(() => { api.get('/students/filters').then((r) => setOpts(r.data)); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'course' ? { branch: '' } : {}) }));
  const branches = [...new Set(opts.branches.filter((b) => !f.course || b.course === f.course).map((b) => b.branch))];

  return (
    <>
      <PageHead title="Seating plans" sub="Search who sits where, or open any room to see its full seat grid." />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters">
          <Field label="Date"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Shift"><select className="input" value={f.shift} onChange={set('shift')}><option value="">All shifts</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
          {tab === 'students' && <>
            <Field label="Course"><select className="input" value={f.course} onChange={set('course')}><option value="">All</option>{opts.courses.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Branch"><select className="input" value={f.branch} onChange={set('branch')}><option value="">All</option>{branches.map((b) => <option key={b}>{b}</option>)}</select></Field>
            <Field label="Year"><select className="input" value={f.year} onChange={set('year')}><option value="">All</option>{opts.years.map((y) => <option key={y} value={y}>Year {y}</option>)}</select></Field>
            <Field label="Semester"><select className="input" value={f.semester} onChange={set('semester')}><option value="">All</option>{opts.semesters.map((y) => <option key={y} value={y}>Sem {y}</option>)}</select></Field>
            <Field label="Name / MUR"><input className="input" value={f.search} onChange={set('search')} /></Field>
          </>}
        </div>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'students' ? 'on' : ''} onClick={() => setTab('students')}>By students</button>
        <button className={tab === 'rooms' ? 'on' : ''} onClick={() => setTab('rooms')}>By room (seat grid)</button>
      </div>
      {tab === 'students' ? <ByStudents f={{ ...f, search }} toast={toast} /> : <ByRoom f={f} toast={toast} />}
    </>
  );
}

function ByStudents({ f, toast }) {
  const [page, setPage] = useState(1);
  const [res, setRes] = useState({ data: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(f);
  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => {
    setLoading(true);
    api.get('/allocations', { params: { ...f, page, limit: 25 } }).then((r) => setRes(r.data)).catch((e) => toast(errMsg(e), 'error')).finally(() => setLoading(false));
    // eslint-disable-next-line
  }, [key, page]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  return (
    <div className="card flat">
      <div className="row spread" style={{ padding: '12px 16px' }}>
        <span className="muted small">{res.total.toLocaleString()} seats match</span>
        <a className="btn ghost sm" style={{ textDecoration: 'none' }} href={`/api/allocations/export?${qs}`}>Export CSV</a>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Shift</th><th>MUR</th><th>Name</th><th>Class</th><th>Subject</th><th>Room</th><th>Floor</th><th>Seat</th></tr></thead>
        <tbody>{res.data.map((a) => (
          <tr key={a._id}>
            <td className="nowrap">{a.date}</td><td>{a.shift}</td><td className="nowrap"><b>{a.enrollmentNo}</b></td><td>{a.studentName}</td>
            <td>{a.course} {a.branch} · Y{a.year} S{a.semester}</td><td>{a.subject}</td>
            <td className="nowrap">{a.building} · <b>{a.roomName}</b></td><td>{floorLabel(a.floor)}</td><td><b>{a.seatNumber}</b></td>
          </tr>
        ))}</tbody>
      </table></div>
      {!loading && !res.data.length && <div className="empty">No allocations match these filters.</div>}
      <Pager page={page} pages={res.pages} total={res.total} onPage={setPage} />
    </div>
  );
}

function ByRoom({ f, toast }) {
  const [rooms, setRooms] = useState([]);
  const [grid, setGrid] = useState(null);
  const [selSeat, setSelSeat] = useState(null);
  const ready = f.date && f.shift;

  const loadRooms = useCallback(() => {
    if (!ready) return setRooms([]);
    api.get('/allocations/rooms', { params: { date: f.date, shift: f.shift } }).then((r) => setRooms(r.data)).catch((e) => toast(errMsg(e), 'error'));
  }, [f.date, f.shift, ready, toast]);
  useEffect(() => { setGrid(null); setSelSeat(null); loadRooms(); }, [loadRooms]);

  const openRoom = useCallback(async (id) => {
    try { setGrid((await api.get(`/allocations/room/${id}`, { params: { date: f.date, shift: f.shift } })).data); setSelSeat(null); } catch (e) { toast(errMsg(e), 'error'); }
  }, [f.date, f.shift, toast]);

  const seat = grid?.seats.find((s) => s.seatNumber === selSeat);
  const clickSeat = async (n, info) => {
    if (seat?.state === 'occupied' && info?.state === 'empty') { // move selected student here
      try { await api.put(`/allocations/${seat.allocationId}/move`, { seatNumber: n }); toast('Student moved.'); openRoom(grid.room._id); loadRooms(); } catch (e) { toast(errMsg(e), 'error'); }
      return;
    }
    setSelSeat(n === selSeat ? null : n);
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${seat.name} from this seat?`)) return;
    try { await api.delete(`/allocations/${seat.allocationId}`); toast('Removed.'); openRoom(grid.room._id); loadRooms(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  if (!ready) return <div className="card empty">Choose a date and a shift above to see the rooms in use.</div>;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
      <div className="card flat" style={{ width: 320, maxWidth: '100%' }}>
        <div style={{ padding: '14px 16px' }}><h3>Rooms in use ({rooms.length})</h3></div>
        <div style={{ maxHeight: '68vh', overflow: 'auto' }}>
          {rooms.map((r) => (
            <button key={r._id} onClick={() => openRoom(r._id)} className={`sched-item${grid?.room._id === r._id ? ' on' : ''}`} style={{ borderRadius: 0, border: 0, borderTop: '1px solid var(--line)' }}>
              <span><b>{r.name}</b><br /><span className="muted small">{r.building} · {floorLabel(r.floor)}</span><div className="small" style={{ marginTop: 4 }}>{r.groups.map((g) => <div key={g.label}>{g.label} <span className="muted">({g.count})</span></div>)}</div></span>
              <span className="badge">{r.total}/{r.capacity}</span>
            </button>
          ))}
          {!rooms.length && <div className="empty">No rooms allocated for this slot.</div>}
        </div>
      </div>

      <div className="card grow" style={{ minWidth: 300 }}>
        {!grid ? <div className="empty">Select a room to view its seat grid.</div> : (
          <>
            <div className="row spread wrap">
              <div><h2>{grid.room.name}</h2><div className="muted small">{grid.room.building} · {floorLabel(grid.room.floor)} · {grid.count}/{grid.room.capacity} seats filled</div></div>
              <button className="btn ghost sm no-print" onClick={() => window.print()}>Print seating sheet</button>
            </div>
            <GroupLegend groups={grid.groups} />
            <div style={{ marginTop: 12 }}><RoomGrid rows={grid.room.rows} columns={grid.room.columns} seats={grid.seats} showNames selected={selSeat} onSeatClick={clickSeat} /></div>
            {seat?.state === 'occupied' && (
              <div className="alert info row spread wrap no-print" style={{ marginTop: 12 }}>
                <span><b>{seat.name}</b> · {seat.enrollmentNo} · seat {seat.seatNumber} · {seat.group} · {seat.subject}. Click an empty seat to move them.</span>
                <button className="btn danger sm" onClick={remove}>Remove from seat</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
