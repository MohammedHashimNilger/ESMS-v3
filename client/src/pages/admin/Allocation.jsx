import React, { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { Modal, PageHead, useToast, fmtDate, todayStr } from '../../components/ui.jsx';

export default function Allocation() {
  const toast = useToast();
  const [slots, setSlots] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState('upcoming');
  const [dlg, setDlg] = useState(null); // { slot, preview, roomIds, busy, error }
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.get('/allocations/slots'), api.get('/rooms')]);
      setSlots(s.data); setRooms(r.data.filter((x) => x.isActive));
    } catch (e) { toast(errMsg(e), 'error'); } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const preview = async (slot, roomIds) => {
    setDlg((d) => ({ ...(d || {}), slot, roomIds, busy: true, error: '' }));
    try {
      const { data } = await api.post('/allocations/run', { date: slot.date, shift: slot.shift, roomIds, dryRun: true });
      setDlg((d) => ({ ...d, preview: data, busy: false }));
    } catch (e) { setDlg((d) => ({ ...d, busy: false, error: errMsg(e) })); }
  };
  const confirm = async () => {
    const { slot, roomIds } = dlg;
    setDlg((d) => ({ ...d, busy: true }));
    try {
      const { data } = await api.post('/allocations/run', { date: slot.date, shift: slot.shift, roomIds });
      toast(`${data.seated} students seated in ${data.roomsNeeded} rooms.`);
      setDlg(null); load();
    } catch (e) { setDlg((d) => ({ ...d, busy: false, error: errMsg(e) })); }
  };
  const clear = async (slot) => {
    if (!window.confirm(`Clear all seating for ${fmtDate(slot.date)} (${slot.shift})?`)) return;
    try { await api.delete('/allocations/slot', { params: { date: slot.date, shift: slot.shift } }); toast('Seating cleared.'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const allocateAll = async () => {
    const pending = slots.filter((s) => s.date >= todayStr() && !s.allocated);
    if (!pending.length) return toast('Nothing pending.');
    setBulk(true); let ok = 0; const failed = [];
    for (const s of pending) {
      try { await api.post('/allocations/run', { date: s.date, shift: s.shift }); ok++; }
      catch (e) { failed.push(`${s.date} ${s.shift}: ${errMsg(e)}`); }
    }
    setBulk(false); load();
    toast(`${ok} slots allocated${failed.length ? `, ${failed.length} failed` : ''}.`, failed.length ? 'error' : 'ok');
    if (failed.length) window.alert(failed.join('\n'));
  };

  const list = slots.filter((s) => (show === 'upcoming' ? s.date >= todayStr() : show === 'past' ? s.date < todayStr() : true));
  const toggleRoom = (id) => {
    const cur = new Set(dlg.roomIds?.length ? dlg.roomIds : rooms.map((r) => r._id));
    cur.has(id) ? cur.delete(id) : cur.add(id);
    setDlg((d) => ({ ...d, roomIds: [...cur] }));
  };
  const selectedIds = dlg ? (dlg.roomIds?.length ? dlg.roomIds : rooms.map((r) => r._id)) : [];
  const p = dlg?.preview;

  return (
    <>
      <PageHead title="Seat allocation" sub="Each date + shift is allocated together, so a room is never double-booked. Every room holds two classes: one in odd columns, one in even columns.">
        <select className="input" style={{ width: 140 }} value={show} onChange={(e) => setShow(e.target.value)}><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="all">All</option></select>
        <button className="btn hi" disabled={bulk} onClick={allocateAll}>{bulk ? 'Allocating…' : 'Allocate all pending'}</button>
      </PageHead>

      <div className="card flat">
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Shift</th><th>Papers</th><th>Seated</th><th /></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.date + s.shift}>
              <td className="nowrap"><b>{fmtDate(s.date)}</b></td><td><span className="badge">{s.shift}</span></td>
              <td>{s.papers.map((x, i) => <div key={i} className="small"><b>{x.subject}</b> <span className="muted">— {x.course} Y{x.year}{x.branch ? ` ${x.branch}` : ''}</span></div>)}</td>
              <td>{s.allocated ? <span className="badge ok">{s.allocated}</span> : <span className="badge warn">Pending</span>}</td>
              <td className="right nowrap">
                <button className="btn sm" onClick={() => preview(s, [])}>{s.allocated ? 'Re-allocate' : 'Preview & allocate'}</button>{' '}
                {s.allocated > 0 && <button className="btn danger sm" onClick={() => clear(s)}>Clear</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        {!loading && !list.length && <div className="empty">No scheduled papers. Create an exam first.</div>}
      </div>

      {dlg && (
        <Modal title={`${fmtDate(dlg.slot.date)} · ${dlg.slot.shift}`} onClose={() => setDlg(null)} width={860}>
          <div className="stack">
            {dlg.error && <div className="alert" role="alert">{dlg.error}</div>}
            {p && (
              <>
                <div className="stats">
                  <div className="stat"><b>{p.eligible}</b><span>Students writing</span></div>
                  <div className="stat"><b>{p.seated}</b><span>Can be seated</span></div>
                  <div className="stat"><b style={{ color: p.unseated ? 'var(--danger)' : 'inherit' }}>{p.unseated}</b><span>Without a seat</span></div>
                  <div className="stat"><b>{p.roomsNeeded}</b><span>Rooms needed</span></div>
                </div>
                {p.duplicates > 0 && <div className="alert info">{p.duplicates} students appear in two papers in this shift; they are seated once.</div>}
                <div className="small"><b>Classes:</b> {p.groups.map((g) => `${g.label} (${g.count})`).join(' · ')}</div>
              </>
            )}
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Rooms to use ({selectedIds.length} of {rooms.length} selected)</summary>
              <div className="row wrap" style={{ gap: 6, marginTop: 10, maxHeight: 180, overflow: 'auto' }}>
                {rooms.map((r) => (
                  <label key={r._id} className="badge" style={{ cursor: 'pointer', background: selectedIds.includes(r._id) ? 'var(--hi)' : undefined, color: selectedIds.includes(r._id) ? 'var(--hi-ink)' : undefined }}>
                    <input type="checkbox" hidden checked={selectedIds.includes(r._id)} onChange={() => toggleRoom(r._id)} />{r.building} · {r.name} ({r.capacity})
                  </label>
                ))}
              </div>
              <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => preview(dlg.slot, dlg.roomIds)}>Recalculate with selected rooms</button>
            </details>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setDlg(null)}>Cancel</button>
              <button className="btn" disabled={dlg.busy || !p || p.unseated > 0} onClick={confirm}>{dlg.busy ? 'Working…' : `Allocate ${p ? p.seated : ''} students`}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
