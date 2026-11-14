import React, { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { Modal, PageHead, useToast, fmtDate } from '../../components/ui.jsx';
import { PrintDoorSheets } from '../../components/RoomGrid.jsx';

const roomLabel = (r) => `${r.building} · ${r.name} (${r.capacity})`;
const dShort = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function Allocation() {
  const toast = useToast();
  const [info, setInfo] = useState({ from: '', to: '', runs: [] });
  const [range, setRange] = useState({ from: '', to: '' });
  const [slots, setSlots] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dlg, setDlg] = useState(null);
  const [sheets, setSheets] = useState(null);

  // Modals for file uploads
  const [dsModal, setDsModal] = useState(null); // datesheet upload & allocate
  const [seatModal, setSeatModal] = useState(null); // direct seating plan import

  const load = useCallback(async () => {
    try {
      const [p, s, r] = await Promise.all([api.get('/allocations/period'), api.get('/allocations/slots'), api.get('/rooms')]);
      setInfo(p.data); setSlots(s.data); setRooms(r.data.filter((x) => x.isActive));
      setRange((cur) => (cur.from ? cur : { from: p.data.from, to: p.data.to }));
    } catch (e) { toast(errMsg(e), 'error'); } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const body = (d, extra = {}) => ({
    from: range.from, to: range.to, roomIds: d.roomIds,
    assignments: d.mode === 'manual' ? Object.entries(d.pins).filter(([, g]) => g.length).map(([roomId, groups]) => ({ roomId, groups })) : [],
    useFullRoom: d.useFullRoom, allowPartial: d.allowPartial, ...extra,
  });
  const preview = async (d) => {
    setDlg({ ...d, busy: true, error: '' });
    try { const { data } = await api.post('/allocations/run', body(d, { dryRun: true })); setDlg((x) => ({ ...x, preview: data, busy: false })); }
    catch (e) { setDlg((x) => ({ ...x, busy: false, preview: null, error: errMsg(e) })); }
  };
  const open = async () => {
    if (!range.from || !range.to || range.from > range.to) return toast('Choose a valid exam period.', 'error');
    const d = { roomIds: [], mode: 'auto', classes: [], pins: {}, useFullRoom: false, allowPartial: false };
    setDlg({ ...d, busy: true });
    try { d.classes = (await api.get('/allocations/classes', { params: range })).data; } catch (e) { setDlg({ ...d, busy: false, error: errMsg(e) }); return; }
    preview(d);
  };
  const confirm = async () => {
    setDlg((d) => ({ ...d, busy: true }));
    try {
      const { data } = await api.post('/allocations/run', body(dlg));
      toast(`${data.seated} students seated in ${data.roomsNeeded} rooms${data.unseated ? ` (${data.unseated} still without a seat)` : ''}.`, data.unseated ? 'error' : 'ok');
      setDlg(null); load();
    } catch (e) { setDlg((d) => ({ ...d, busy: false, error: errMsg(e) })); }
  };
  const clear = async (period) => {
    const [from, to] = period.split('_');
    if (!window.confirm(`Clear all seating from ${fmtDate(from)} to ${fmtDate(to)}?`)) return;
    try { await api.delete('/allocations/period', { params: { from, to } }); toast('Seating cleared.'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const printDoors = async (period) => {
    try { const { data } = await api.get('/allocations/door-sheets', { params: { period } }); if (!data.length) return toast('Nothing to print.', 'error'); setSheets(data); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const roomById = (id) => rooms.find((r) => r._id === id);
  const selectedIds = dlg ? (dlg.roomIds?.length ? dlg.roomIds : rooms.map((r) => r._id)) : [];
  const toggleRoom = (id) => { const cur = new Set(selectedIds); cur.has(id) ? cur.delete(id) : cur.add(id); setDlg((d) => ({ ...d, roomIds: [...cur] })); };
  const addPin = (label, roomId) => {
    if (!roomId) return;
    const r = roomById(roomId);
    const maxCourses = r ? r.columns || 8 : 8;
    setDlg((d) => {
      const cur = d.pins[roomId] || [];
      return cur.includes(label) || cur.length >= maxCourses ? d : { ...d, pins: { ...d.pins, [roomId]: [...cur, label] } };
    });
  };
  const removePin = (label, roomId) => setDlg((d) => ({ ...d, pins: { ...d.pins, [roomId]: (d.pins[roomId] || []).filter((g) => g !== label) } }));

  const p = dlg?.preview;
  const inRange = slots.filter((s) => s.date >= range.from && s.date <= range.to);
  const hasExisting = info.runs.some((r) => { const [a, b] = r.period.split('_'); return a <= range.to && b >= range.from; });

  // Datesheet upload handlers
  const onDatesheetPreview = async (e) => {
    e.preventDefault();
    if (!dsModal.file) return toast('Select a datesheet file to upload.', 'error');
    setDsModal((m) => ({ ...m, busy: true, error: '', preview: null }));
    const fd = new FormData();
    fd.append('file', dsModal.file);
    fd.append('dryRun', 'true');
    if (dsModal.examName) fd.append('examName', dsModal.examName);
    fd.append('useFullRoom', dsModal.useFullRoom ? 'true' : 'false');
    fd.append('allowPartial', dsModal.allowPartial ? 'true' : 'false');
    try {
      const { data } = await api.post('/allocations/upload-datesheet', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 });
      setDsModal((m) => ({ ...m, busy: false, preview: data }));
    } catch (err) {
      setDsModal((m) => ({ ...m, busy: false, error: errMsg(err) }));
    }
  };

  const onDatesheetCommit = async () => {
    if (!dsModal.file) return;
    setDsModal((m) => ({ ...m, busy: true, error: '' }));
    const fd = new FormData();
    fd.append('file', dsModal.file);
    fd.append('dryRun', 'false');
    if (dsModal.examName) fd.append('examName', dsModal.examName);
    fd.append('useFullRoom', dsModal.useFullRoom ? 'true' : 'false');
    fd.append('allowPartial', dsModal.allowPartial ? 'true' : 'false');
    try {
      const { data } = await api.post('/allocations/upload-datesheet', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
      toast(`Successfully allocated! ${data.seated} students seated across ${data.roomsNeeded} rooms.`);
      setDsModal(null);
      load();
    } catch (err) {
      setDsModal((m) => ({ ...m, busy: false, error: errMsg(err) }));
    }
  };

  // Seating file direct import handler
  const onSeatingImport = async (e) => {
    e.preventDefault();
    const file = e.target.file.files[0];
    if (!file) return;
    setSeatModal((s) => ({ ...s, busy: true, error: '', result: null }));
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/allocations/import-seating', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
      setSeatModal((s) => ({ ...s, busy: false, result: data }));
      toast(`Imported ${data.seatRecordsCreated} seat records successfully!`);
      load();
    } catch (err) {
      setSeatModal((s) => ({ ...s, busy: false, error: errMsg(err) }));
    }
  };

  return (
    <>
      {sheets && <PrintDoorSheets sheets={sheets} onDone={() => setSheets(null)} />}
      <PageHead title="Seat allocation" sub="Seats are allocated for the exam period: students keep their assigned room and seat for all papers, and multiple courses share rooms with alternating columns.">
        <button className="btn hi" onClick={() => setDsModal({ file: null, examName: '', useFullRoom: false, allowPartial: false, preview: null, error: '', busy: false })}>
          📁 Upload datesheet & allocate
        </button>
        <button className="btn ghost" onClick={() => setSeatModal({ busy: false, error: '', result: null })}>
          📥 Upload seating plan file
        </button>
      </PageHead>

      <div className="card" style={{ padding: 16 }}>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="stack" style={{ gap: 4 }}><span className="small muted">Exam period from</span><input className="input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="stack" style={{ gap: 4 }}><span className="small muted">to</span><input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button className="btn hi" onClick={open} disabled={!range.from || !range.to}>Preview & allocate</button>
        </div>
        {hasExisting && <div className="muted small" style={{ marginTop: 8 }}>This period already has seating. Allocating again replaces it, including seats you moved by hand.</div>}
      </div>

      {info.runs.length > 0 && (
        <div className="card flat" style={{ marginTop: 14 }}>
          <div className="table-wrap"><table>
            <thead><tr><th>Allocated period</th><th>Students</th><th>Seat records</th><th /></tr></thead>
            <tbody>{info.runs.map((r) => { const [a, b] = r.period.split('_'); return (
              <tr key={r.period}><td><b>{fmtDate(a)}</b> to <b>{fmtDate(b)}</b></td><td>{r.students}</td><td>{r.papers}</td>
                <td className="right nowrap"><button className="btn sm" onClick={() => printDoors(r.period)}>Print door sheets</button>{' '}<button className="btn danger sm" onClick={() => clear(r.period)}>Clear</button></td></tr>
            ); })}</tbody>
          </table></div>
        </div>
      )}

      <h3 style={{ margin: '20px 0 8px' }}>Papers in this period</h3>
      <div className="card flat">
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Shift</th><th>Papers</th><th>Seated</th></tr></thead>
          <tbody>{inRange.map((s) => (
            <tr key={s.date + s.shift}>
              <td className="nowrap"><b>{fmtDate(s.date)}</b></td><td><span className="badge">{s.shift}</span></td>
              <td>{s.papers.slice(0, 4).map((x, i) => <div key={i} className="small"><b>{x.subject}</b> <span className="muted">— {x.course} Y{x.year}{x.branch ? ` ${x.branch}` : ''}</span></div>)}{s.papers.length > 4 && <div className="muted small">+ {s.papers.length - 4} more papers</div>}</td>
              <td>{s.allocated ? <span className="badge ok">{s.allocated}</span> : <span className="badge warn">Pending</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!loading && !inRange.length && <div className="empty">No scheduled papers in this period. Use "Upload datesheet & allocate" above to start.</div>}
      </div>

      {/* Manual / Auto Allocation Preview Modal */}
      {dlg && (
        <Modal title={`Allocate ${dShort(range.from)} – ${dShort(range.to)}`} onClose={() => setDlg(null)} width={980}>
          <div className="stack">
            {dlg.error && <div className="alert" role="alert">{dlg.error}</div>}
            <div className="tabs">
              <button className={dlg.mode === 'auto' ? 'on' : ''} onClick={() => preview({ ...dlg, mode: 'auto' })}>Auto allocate</button>
              <button className={dlg.mode === 'manual' ? 'on' : ''} onClick={() => preview({ ...dlg, mode: 'manual' })}>Choose rooms for courses</button>
            </div>

            {p && (
              <>
                <div className="stats">
                  <div className="stat"><b>{p.eligible}</b><span>Students writing</span></div>
                  <div className="stat"><b>{p.seated}</b><span>Can be seated</span></div>
                  <div className="stat"><b style={{ color: p.unseated ? 'var(--danger)' : 'inherit' }}>{p.unseated}</b><span>Without a seat</span></div>
                  <div className="stat"><b>{p.roomsNeeded}</b><span>Rooms needed{p.manualRooms ? ` (${p.manualRooms} chosen by you)` : ''}</span></div>
                </div>
                {p.duplicates > 0 && <div className="alert info">{p.duplicates} papers fall in the same slot as another paper of the same student; they are seated once.</div>}
                {p.warnings?.map((w) => <div key={w} className="alert">{w}</div>)}
                {p.unseated > 0 && <div className="alert">Not seated: {p.unseatedGroups.map((g) => `${g.label} (${g.count})`).join(' · ')}. Select more rooms or add rooms.</div>}
                {p.rooms?.length > 0 && (
                  <div className="small" style={{ maxHeight: 150, overflow: 'auto', background: 'var(--surface-sunken)', padding: 10, borderRadius: 6 }}>
                    <b>Courses per room:</b>
                    {p.rooms.map((rm) => (
                      <div key={rm.name} style={{ margin: '4px 0' }}>
                        <b>{rm.name}</b> ({rm.count} seats): {rm.groups.join(', ')}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {dlg.mode === 'manual' && (
              <div className="card flat" style={{ padding: 14 }}>
                <div className="muted small" style={{ marginBottom: 8 }}>
                  Pick the rooms each course sits in for the whole period. A room can hold multiple courses that alternate columns (odd / even columns). Courses you leave empty are placed automatically in the other rooms.
                </div>
                <div className="stack" style={{ gap: 10, maxHeight: 280, overflow: 'auto' }}>
                  {dlg.classes.map((c) => {
                    const mine = Object.entries(dlg.pins).filter(([, g]) => g.includes(c.label)).map(([id]) => id);
                    return (
                      <div key={c.label} className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                        <span style={{ minWidth: 260 }}><b>{c.label}</b> <span className="muted small">({c.count} students · {c.shifts.join(' + ')} · {dShort(c.from)} – {dShort(c.to)})</span></span>
                        <select className="input" style={{ width: 250 }} value="" onChange={(e) => addPin(c.label, e.target.value)}>
                          <option value="">+ Add a room…</option>
                          {rooms.filter((r) => !mine.includes(r._id) && (dlg.pins[r._id] || []).length < (r.columns || 8)).map((r) => <option key={r._id} value={r._id}>{roomLabel(r)}{(dlg.pins[r._id] || []).length ? ' · shared' : ''}</option>)}
                        </select>
                        {mine.map((id) => <span key={id} className="badge" style={{ cursor: 'pointer' }} title="Remove" onClick={() => removePin(c.label, id)}>{roomById(id)?.name} ✕</span>)}
                      </div>
                    );
                  })}
                </div>
                <button className="btn ghost sm" style={{ marginTop: 10 }} disabled={dlg.busy} onClick={() => preview(dlg)}>Recalculate</button>
              </div>
            )}

            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Rooms available for automatic seating ({selectedIds.length} of {rooms.length} selected)</summary>
              <div className="row wrap" style={{ gap: 6, marginTop: 10, maxHeight: 180, overflow: 'auto' }}>
                {rooms.map((r) => (
                  <label key={r._id} className="badge" style={{ cursor: 'pointer', background: selectedIds.includes(r._id) ? 'var(--hi)' : undefined, color: selectedIds.includes(r._id) ? 'var(--hi-ink)' : undefined }}>
                    <input type="checkbox" hidden checked={selectedIds.includes(r._id)} onChange={() => toggleRoom(r._id)} />{roomLabel(r)}
                  </label>
                ))}
              </div>
              <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => preview(dlg)}>Recalculate with selected rooms</button>
            </details>

            <div className="row wrap" style={{ gap: 18 }}>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={dlg.useFullRoom} onChange={(e) => preview({ ...dlg, useFullRoom: e.target.checked })} /> If rooms run short, let a course also use the empty columns</label>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={dlg.allowPartial} onChange={(e) => setDlg({ ...dlg, allowPartial: e.target.checked })} /> Save even if some students get no seat</label>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setDlg(null)}>Cancel</button>
              <button className="btn" disabled={dlg.busy || !p || !p.seated || (p.unseated > 0 && !dlg.allowPartial)} onClick={confirm}>{dlg.busy ? 'Working…' : `Allocate ${p ? p.seated : ''} students`}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Datesheet Upload & Allocate Modal */}
      {dsModal && (
        <Modal title="Upload Datesheet & Allocate" onClose={() => setDsModal(null)} width={920}>
          <div className="stack" style={{ gap: 14 }}>
            <div className="alert info">
              Upload your exam datesheet spreadsheet (<b>.xlsx, .xls, .csv</b>). Exams will be created automatically and students will be seated across active rooms with multiple courses sharing rooms in alternating columns!
            </div>

            <form onSubmit={onDatesheetPreview} className="stack" style={{ gap: 12 }}>
              <div className="row wrap" style={{ gap: 12 }}>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="input grow"
                  required
                  onChange={(e) => setDsModal((m) => ({ ...m, file: e.target.files[0], preview: null }))}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Exam session title (optional)"
                  style={{ width: 260 }}
                  value={dsModal.examName}
                  onChange={(e) => setDsModal((m) => ({ ...m, examName: e.target.value }))}
                />
              </div>

              <div className="row wrap" style={{ gap: 18 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={dsModal.useFullRoom}
                    onChange={(e) => setDsModal((m) => ({ ...m, useFullRoom: e.target.checked, preview: null }))}
                  />
                  Use full room if seats run short
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={dsModal.allowPartial}
                    onChange={(e) => setDsModal((m) => ({ ...m, allowPartial: e.target.checked }))}
                  />
                  Allow partial allocation if rooms are insufficient
                </label>
              </div>

              {dsModal.error && <div className="alert">{dsModal.error}</div>}

              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small muted">Supported: Mid-Term Datesheet, End-Term, Multi-Course Excel / CSV</span>
                <button type="submit" className="btn" disabled={dsModal.busy || !dsModal.file}>
                  {dsModal.busy ? 'Calculating…' : 'Preview Allocation'}
                </button>
              </div>
            </form>

            {dsModal.preview && (
              <div className="stack" style={{ gap: 12, marginTop: 8 }}>
                <div className="alert ok">
                  <b>Datesheet parsed:</b> {dsModal.preview.examsCount} classes, {dsModal.preview.papersCount} papers scheduled between <b>{fmtDate(dsModal.preview.from)}</b> and <b>{fmtDate(dsModal.preview.to)}</b>.
                </div>

                <div className="stats">
                  <div className="stat"><b>{dsModal.preview.eligible}</b><span>Students writing</span></div>
                  <div className="stat"><b>{dsModal.preview.seated}</b><span>Seated</span></div>
                  <div className="stat"><b style={{ color: dsModal.preview.unseated ? 'var(--danger)' : 'inherit' }}>{dsModal.preview.unseated}</b><span>Without a seat</span></div>
                  <div className="stat"><b>{dsModal.preview.roomsNeeded}</b><span>Rooms needed</span></div>
                </div>

                {dsModal.preview.rooms?.length > 0 && (
                  <div style={{ maxHeight: 180, overflow: 'auto', background: 'var(--surface-sunken)', padding: 12, borderRadius: 6, fontSize: '0.85rem' }}>
                    <b>Rooms and courses assigned:</b>
                    {dsModal.preview.rooms.map((rm) => (
                      <div key={rm.name} style={{ margin: '4px 0' }}>
                        <b>{rm.name}</b> ({rm.count} students): {rm.groups.join(', ')}
                      </div>
                    ))}
                  </div>
                )}

                <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => setDsModal(null)}>Cancel</button>
                  <button
                    className="btn hi"
                    disabled={dsModal.busy || (dsModal.preview.unseated > 0 && !dsModal.allowPartial)}
                    onClick={onDatesheetCommit}
                  >
                    {dsModal.busy ? 'Saving Seating…' : `Confirm & Save Seating (${dsModal.preview.seated} students)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Direct Seating Plan Import Modal */}
      {seatModal && (
        <Modal title="Upload Seating Plan File" onClose={() => setSeatModal(null)} width={820}>
          <form className="stack" style={{ gap: 14 }} onSubmit={onSeatingImport}>
            <div className="alert info">
              Upload a student seating spreadsheet (<b>.xlsx, .xls, .csv</b>).
              Required columns: <b>MUR / Enrollment No</b>, <b>Room Name</b>, <b>Seat Number</b>.
              Optional columns: <b>Date</b>, <b>Shift</b>, <b>Subject</b>.
            </div>

            <div className="row wrap" style={{ gap: 10 }}>
              <a className="btn ghost sm" style={{ textDecoration: 'none' }} href="/api/allocations/seating-template">
                Download Excel Template
              </a>
              <a className="btn ghost sm" style={{ textDecoration: 'none' }} href="/api/allocations/seating-template?format=csv">
                Download CSV Template
              </a>
            </div>

            <input type="file" name="file" accept=".xlsx,.xls,.csv" className="input" required />

            {seatModal.error && <div className="alert">{seatModal.error}</div>}

            {seatModal.result && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="alert ok">
                  <b>{seatModal.result.validRows}</b> students assigned seats · <b>{seatModal.result.seatRecordsCreated}</b> seat records created.
                </div>
                {seatModal.result.errorsCount > 0 && (
                  <div className="small" style={{ maxHeight: 150, overflow: 'auto', background: 'var(--surface-sunken)', padding: 10, borderRadius: 6 }}>
                    <b>Errors / Skipped rows ({seatModal.result.errorsCount}):</b>
                    {seatModal.result.errors.map((e, idx) => (
                      <div key={idx}>Row {e.row}: {e.message}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn ghost" onClick={() => setSeatModal(null)}>Close</button>
              <button type="submit" className="btn hi" disabled={seatModal.busy}>
                {seatModal.busy ? 'Importing…' : 'Upload & Import Seating'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
