import React, { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { Modal, Field, PageHead, useToast, fmtDate, SHIFTS } from '../../components/ui.jsx';

const blank = { name: '', course: '', year: 1, semester: '', startDate: '', endDate: '', entries: [] };

function datesBetween(a, b) {
  const out = []; const d = new Date(a + 'T00:00:00Z'); const end = new Date(b + 'T00:00:00Z');
  while (d <= end && out.length < 120) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export default function Exams() {
  const toast = useToast();
  const [exams, setExams] = useState([]);
  const [opts, setOpts] = useState({ courses: [], branches: [] });
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  const [fillShift, setFillShift] = useState('Morning');

  const load = useCallback(() => api.get('/exams').then((r) => setExams(r.data)).catch((e) => toast(errMsg(e), 'error')), [toast]);
  useEffect(() => { load(); api.get('/students/filters').then((r) => setOpts(r.data)); }, [load]);

  const branchOpts = edit ? [...new Set(opts.branches.filter((b) => b.course === edit.course).map((b) => b.branch))] : [];
  const setEntry = (i, patch) => setEdit((e) => ({ ...e, entries: e.entries.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const addEntry = () => setEdit((e) => ({ ...e, entries: [...e.entries, { date: e.startDate, shift: 'Morning', subject: '', branch: '' }] }));
  const fillDays = () => {
    if (!edit.startDate || !edit.endDate) return toast('Set start and end dates first.', 'error');
    setEdit((e) => {
      const have = new Set(e.entries.map((x) => `${x.date}|${x.shift}`));
      const add = datesBetween(e.startDate, e.endDate).filter((d) => !have.has(`${d}|${fillShift}`)).map((date) => ({ date, shift: fillShift, subject: '', branch: '' }));
      return { ...e, entries: [...e.entries, ...add].sort((a, b) => a.date.localeCompare(b.date)) };
    });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const { data } = edit._id ? await api.put(`/exams/${edit._id}`, edit) : await api.post('/exams', edit);
      toast(data.allocationsCleared ? `Exam saved. ${data.allocationsCleared} seat allocations were cleared — re-run allocation.` : 'Exam saved.');
      setEdit(null); load();
    } catch (e2) { toast(errMsg(e2), 'error'); }
  };
  const del = async (x) => {
    if (!window.confirm(`Delete "${x.name}" and all its seat allocations?`)) return;
    try { await api.delete(`/exams/${x._id}`); toast('Exam deleted.'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const open = async (x) => { try { setView((await api.get(`/exams/${x._id}/summary`)).data); } catch (e) { toast(errMsg(e), 'error'); } };

  return (
    <>
      <PageHead title="Exams" sub="Create an exam for a class, then add each paper with its date, shift and subject.">
        <button className="btn" onClick={() => setEdit({ ...blank })}>+ Create exam</button>
      </PageHead>

      <div className="card flat">
        <div className="table-wrap"><table>
          <thead><tr><th>Exam</th><th>Class</th><th>Dates</th><th>Papers</th><th /></tr></thead>
          <tbody>{exams.map((x) => (
            <tr key={x._id}>
              <td><b>{x.name}</b></td>
              <td>{x.course} · Year {x.year}{x.semester ? ` · Sem ${x.semester}` : ''}</td>
              <td>{fmtDate(x.startDate)} → {fmtDate(x.endDate)}</td>
              <td>{x.entries.length}</td>
              <td className="right nowrap">
                <button className="btn ghost sm" onClick={() => open(x)}>View schedule</button>{' '}
                <button className="btn ghost sm" onClick={() => setEdit({ ...x, semester: x.semester ?? '' })}>Edit</button>{' '}
                <button className="btn danger sm" onClick={() => del(x)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        {!exams.length && <div className="empty">No exams yet.</div>}
      </div>

      {view && (
        <Modal title={view.name} onClose={() => setView(null)} width={820}>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Shift</th><th>Subject</th><th>Branch</th><th>Students</th><th>Seated</th></tr></thead>
            <tbody>{view.entries.map((e) => (
              <tr key={e._id}><td>{fmtDate(e.date)}</td><td><span className="badge">{e.shift}</span></td><td><b>{e.subject}</b></td><td>{e.branch || 'All'}</td><td>{e.eligible}</td>
                <td>{e.seated >= e.eligible && e.eligible > 0 ? <span className="badge ok">{e.seated}</span> : e.seated ? <span className="badge warn">{e.seated}</span> : <span className="badge">0</span>}</td></tr>
            ))}</tbody>
          </table></div>
        </Modal>
      )}

      {edit && (
        <Modal title={edit._id ? 'Edit exam' : 'Create exam'} onClose={() => setEdit(null)} width={900}>
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <Field label="Exam name"><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="B.Tech 1st Year End-Sem" /></Field>
              <Field label="Course"><select className="input" required value={edit.course} onChange={(e) => setEdit({ ...edit, course: e.target.value })}><option value="">Select…</option>{opts.courses.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Year"><input className="input" type="number" min="1" max="8" required value={edit.year} onChange={(e) => setEdit({ ...edit, year: e.target.value })} /></Field>
              <Field label="Semester (blank = all)"><input className="input" type="number" min="1" max="16" value={edit.semester} onChange={(e) => setEdit({ ...edit, semester: e.target.value })} /></Field>
              <Field label="Start date"><input className="input" type="date" required value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></Field>
              <Field label="End date"><input className="input" type="date" required value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></Field>
            </div>

            <div className="row spread wrap">
              <h3>Papers</h3>
              <div className="row wrap">
                <select className="input" style={{ width: 130 }} value={fillShift} onChange={(e) => setFillShift(e.target.value)}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select>
                <button type="button" className="btn ghost sm" onClick={fillDays}>Add a paper for every day</button>
                <button type="button" className="btn ghost sm" onClick={addEntry}>+ Add paper</button>
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {edit.entries.map((en, i) => (
                <div key={i} className="row wrap" style={{ gap: 8 }}>
                  <input className="input" style={{ width: 160 }} type="date" min={edit.startDate} max={edit.endDate} required value={en.date} onChange={(e) => setEntry(i, { date: e.target.value })} />
                  <select className="input" style={{ width: 130 }} value={en.shift} onChange={(e) => setEntry(i, { shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select>
                  <input className="input grow" style={{ minWidth: 160 }} required placeholder="Subject (e.g. DSA)" value={en.subject} onChange={(e) => setEntry(i, { subject: e.target.value })} />
                  <select className="input" style={{ width: 170 }} value={en.branch} onChange={(e) => setEntry(i, { branch: e.target.value })}><option value="">All branches</option>{branchOpts.map((b) => <option key={b}>{b}</option>)}</select>
                  <button type="button" className="btn danger sm" onClick={() => setEdit({ ...edit, entries: edit.entries.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              {!edit.entries.length && <div className="muted small">No papers yet. Add papers one by one, or generate one per day and fill in subjects.</div>}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn">Save exam</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
