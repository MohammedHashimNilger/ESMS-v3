import React, { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { Modal, Field, PageHead, Pager, useToast, useDebounced } from '../../components/ui.jsx';

const blank = { name: '', enrollmentNo: '', email: '', course: '', branch: '', year: 1, semester: 1, status: 'active' };

export default function Students() {
  const toast = useToast();
  const [filters, setFilters] = useState({ search: '', course: '', branch: '', year: '', semester: '' });
  const [opts, setOpts] = useState({ courses: [], branches: [], years: [], semesters: [] });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState({ data: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(null);
  const search = useDebounced(filters.search);

  const loadOpts = useCallback(() => api.get('/students/filters').then((r) => setOpts(r.data)), []);
  useEffect(() => { loadOpts(); }, [loadOpts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/students', { params: { ...filters, search, page, limit: 25 } });
      setRes(data);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setLoading(false); }
    // eslint-disable-next-line
  }, [filters.course, filters.branch, filters.year, filters.semester, search, page]);
  useEffect(() => { load(); }, [load]);

  const setF = (k) => (e) => { setPage(1); setFilters((f) => ({ ...f, [k]: e.target.value, ...(k === 'course' ? { branch: '' } : {}) })); };
  const branches = opts.branches.filter((b) => !filters.course || b.course === filters.course).map((b) => b.branch);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (edit._id) await api.put(`/students/${edit._id}`, edit); else await api.post('/students', edit);
      toast('Student saved.'); setEdit(null); load(); loadOpts();
    } catch (e2) { toast(errMsg(e2), 'error'); }
  };
  const del = async (s) => {
    if (!window.confirm(`Delete ${s.name} (${s.enrollmentNo})? Their seat allocations are removed too.`)) return;
    try { await api.delete(`/students/${s._id}`); toast('Student deleted.'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const reset = async (s) => {
    if (!window.confirm(`Reset the account of ${s.name}? They will need to sign up again.`)) return;
    try { await api.post(`/students/${s._id}/reset-account`); toast('Account reset.'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const doImport = async (e) => {
    e.preventDefault();
    const file = e.target.file.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    setImp((i) => ({ ...i, busy: true, result: null }));
    try {
      const { data } = await api.post('/students/import', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
      setImp({ busy: false, result: data }); load(); loadOpts();
    } catch (e2) { setImp({ busy: false, result: null, error: errMsg(e2) }); }
  };

  return (
    <>
      <PageHead title="Students" sub="Master list of every student. Students can only sign up if they appear here.">
        <button className="btn ghost" onClick={() => setImp({ busy: false })}>Import CSV / Excel</button>
        <button className="btn" onClick={() => setEdit({ ...blank })}>+ Add student</button>
      </PageHead>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters">
          <Field label="Search name or MUR"><input className="input" value={filters.search} onChange={setF('search')} placeholder="e.g. MUR2025 or Aarav" /></Field>
          <Field label="Course"><select className="input" value={filters.course} onChange={setF('course')}><option value="">All</option>{opts.courses.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Branch"><select className="input" value={filters.branch} onChange={setF('branch')}><option value="">All</option>{[...new Set(branches)].map((b) => <option key={b}>{b}</option>)}</select></Field>
          <Field label="Year"><select className="input" value={filters.year} onChange={setF('year')}><option value="">All</option>{opts.years.map((y) => <option key={y} value={y}>Year {y}</option>)}</select></Field>
          <Field label="Semester"><select className="input" value={filters.semester} onChange={setF('semester')}><option value="">All</option>{opts.semesters.map((y) => <option key={y} value={y}>Sem {y}</option>)}</select></Field>
        </div>
      </div>

      <div className="card flat">
        <div className="table-wrap"><table>
          <thead><tr><th>MUR</th><th>Name</th><th>Course</th><th>Branch</th><th>Year</th><th>Sem</th><th>Account</th><th /></tr></thead>
          <tbody>
            {res.data.map((s) => (
              <tr key={s._id}>
                <td className="nowrap"><b>{s.enrollmentNo}</b></td><td>{s.name}</td><td>{s.course}</td><td>{s.branch}</td><td>{s.year}</td><td>{s.semester}</td>
                <td>{s.status === 'debarred' ? <span className="badge bad">Debarred</span> : s.isRegistered ? <span className="badge ok">Registered</span> : <span className="badge">Not signed up</span>}</td>
                <td className="right nowrap">
                  <button className="btn ghost sm" onClick={() => setEdit({ ...s })}>Edit</button>{' '}
                  {s.isRegistered && <><button className="btn ghost sm" onClick={() => reset(s)}>Reset login</button>{' '}</>}
                  <button className="btn danger sm" onClick={() => del(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!loading && !res.data.length && <div className="empty">No students match. Import your student list to get started.</div>}
        {loading && <div className="empty">Loading…</div>}
        <Pager page={page} pages={res.pages} total={res.total} onPage={setPage} />
      </div>

      {edit && (
        <Modal title={edit._id ? 'Edit student' : 'Add student'} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <Field label="Full name"><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="MUR / Enrollment no."><input className="input" required disabled={!!edit._id} value={edit.enrollmentNo} onChange={(e) => setEdit({ ...edit, enrollmentNo: e.target.value })} /></Field>
              <Field label="Course"><input className="input" required list="courses" value={edit.course} onChange={(e) => setEdit({ ...edit, course: e.target.value })} /></Field>
              <Field label="Branch"><input className="input" required value={edit.branch} onChange={(e) => setEdit({ ...edit, branch: e.target.value })} /></Field>
              <Field label="Year"><input className="input" type="number" min="1" max="8" required value={edit.year} onChange={(e) => setEdit({ ...edit, year: e.target.value })} /></Field>
              <Field label="Semester"><input className="input" type="number" min="1" max="16" required value={edit.semester} onChange={(e) => setEdit({ ...edit, semester: e.target.value })} /></Field>
              {!edit.isRegistered && <Field label="Email (optional, checked at signup)"><input className="input" type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>}
              <Field label="Status"><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">Active</option><option value="debarred">Debarred (no seat)</option></select></Field>
            </div>
            <datalist id="courses">{opts.courses.map((c) => <option key={c} value={c} />)}</datalist>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn">Save</button></div>
          </form>
        </Modal>
      )}

      {imp && (
        <Modal title="Import students" onClose={() => setImp(null)}>
          <form className="stack" onSubmit={doImport}>
            <div className="alert info">Columns: <b>Name, Enrollment No (MUR), Email (optional), Course, Branch, Year, Semester</b>. Up to 20,000 rows per file. Existing MURs are updated, new ones are added. <a href="/api/students/template">Download template</a></div>
            <input className="input" type="file" name="file" accept=".csv,.xlsx,.xls" required />
            {imp.error && <div className="alert">{imp.error}</div>}
            {imp.result && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="alert info"><b>{imp.result.created}</b> added · <b>{imp.result.updated}</b> updated · <b>{imp.result.invalid}</b> skipped{imp.result.emailConflicts ? ` · ${imp.result.emailConflicts} duplicate emails ignored` : ''}</div>
                {imp.result.errors.length > 0 && <div className="small" style={{ maxHeight: 160, overflow: 'auto' }}>{imp.result.errors.map((x, i) => <div key={i}>Row {x.row}: {x.message}</div>)}</div>}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" disabled={imp.busy}>{imp.busy ? 'Importing…' : 'Upload & import'}</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
