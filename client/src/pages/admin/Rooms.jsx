import React, { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import RoomGrid from '../../components/RoomGrid.jsx';
import { Modal, Field, PageHead, useToast, floorLabel } from '../../components/ui.jsx';

const blank = { name: '', building: '', floor: 0, rows: 10, columns: 8, disabledSeats: [], isActive: true };

export default function Rooms() {
  const toast = useToast();
  const [rooms, setRooms] = useState([]);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setRooms((await api.get('/rooms', { params: { search } })).data); } catch (e) { toast(errMsg(e), 'error'); } finally { setLoading(false); }
    // eslint-disable-next-line
  }, [search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (edit._id) await api.put(`/rooms/${edit._id}`, edit); else await api.post('/rooms', edit);
      toast('Room saved.'); setEdit(null); load();
    } catch (e2) { toast(errMsg(e2), 'error'); }
  };
  const del = async (r) => {
    if (!window.confirm(`Delete ${r.building} – ${r.name}?`)) return;
    try { await api.delete(`/rooms/${r._id}`); toast('Room deleted.'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const toggleSeat = (n) => setEdit((r) => ({ ...r, disabledSeats: r.disabledSeats.includes(n) ? r.disabledSeats.filter((x) => x !== n) : [...r.disabledSeats, n] }));
  const num = (k) => (e) => setEdit((r) => {
    const v = Math.max(1, Math.min(40, Number(e.target.value) || 1));
    const next = { ...r, [k]: v };
    next.disabledSeats = r.disabledSeats.filter((s) => s <= next.rows * next.columns); // drop seats outside new size
    return next;
  });

  const total = rooms.reduce((n, r) => n + (r.isActive ? r.capacity : 0), 0);
  return (
    <>
      <PageHead title="Exam rooms" sub={`${rooms.length} rooms · ${total.toLocaleString()} usable seats`}>
        <input className="input" style={{ width: 220 }} placeholder="Search room or building" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" onClick={() => setEdit({ ...blank })}>+ Add room</button>
      </PageHead>

      <div className="card flat">
        <div className="table-wrap"><table>
          <thead><tr><th>Building</th><th>Room</th><th>Floor</th><th>Layout</th><th>Seats</th><th>Status</th><th /></tr></thead>
          <tbody>{rooms.map((r) => (
            <tr key={r._id}>
              <td>{r.building}</td><td><b>{r.name}</b></td><td>{floorLabel(r.floor)}</td>
              <td>{r.rows} rows × {r.columns} cols</td>
              <td><b>{r.capacity}</b>{r.disabledSeats.length > 0 && <span className="muted small"> ({r.disabledSeats.length} disabled)</span>}</td>
              <td>{r.isActive ? <span className="badge ok">Active</span> : <span className="badge">Inactive</span>}</td>
              <td className="right nowrap"><button className="btn ghost sm" onClick={() => setEdit({ ...r })}>Edit</button>{' '}<button className="btn danger sm" onClick={() => del(r)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        {!loading && !rooms.length && <div className="empty">No rooms yet. Add your first exam room.</div>}
      </div>

      {edit && (
        <Modal title={edit._id ? 'Edit room' : 'Add room'} onClose={() => setEdit(null)} width={820}>
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <Field label="Building"><input className="input" required value={edit.building} onChange={(e) => setEdit({ ...edit, building: e.target.value })} placeholder="Main Building" /></Field>
              <Field label="Room name / number"><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Room 119" /></Field>
              <Field label="Floor (0 = ground)"><input className="input" type="number" min="0" max="30" required value={edit.floor} onChange={(e) => setEdit({ ...edit, floor: e.target.value })} /></Field>
              <Field label="Rows (benches front to back)"><input className="input" type="number" min="1" max="40" value={edit.rows} onChange={num('rows')} /></Field>
              <Field label="Columns"><input className="input" type="number" min="1" max="40" value={edit.columns} onChange={num('columns')} /></Field>
              <Field label="Status"><select className="input" value={edit.isActive ? '1' : '0'} onChange={(e) => setEdit({ ...edit, isActive: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive (skip in allocation)</option></select></Field>
            </div>
            <div>
              <div className="row spread"><b>Seat preview</b><span className="muted small">{edit.rows * edit.columns - edit.disabledSeats.length} usable seats · click a seat to disable / enable it</span></div>
              <RoomGrid rows={edit.rows} columns={edit.columns} disabled={edit.disabledSeats} onSeatClick={toggleSeat} />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn">Save room</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
