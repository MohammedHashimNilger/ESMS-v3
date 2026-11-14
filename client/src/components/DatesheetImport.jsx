import React, { useMemo, useRef, useState } from 'react';
import api, { errMsg } from '../api';
import { Modal, Field, useToast, fmtDate } from './ui.jsx';

const SHIFT_OPTS = ['Morning', 'Afternoon', 'Evening'];

/**
 * Upload an Excel / CSV datesheet -> review & fix rows -> create exams automatically.
 * Steps: 1 upload, 2 review (map course/branch names, edit rows), 3 done.
 */
export default function DatesheetImport({ onClose, onDone }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null); // { rows, maps, fileName }
  const [rows, setRows] = useState([]);
  const [examName, setExamName] = useState('');
  const [courseMap, setCourseMap] = useState({});
  const [branchMap, setBranchMap] = useState({});
  const [mode, setMode] = useState('merge');
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [onlyBad, setOnlyBad] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE = 50;

  const payload = (extra = {}) => ({ rows, examName, courseMap, branchMap, mode, ...extra });

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data: d } = await api.post('/exams/datesheet/parse', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      setData(d); setRows(d.rows); setExamName(d.suggestedName || ''); setCourseMap({}); setBranchMap({}); setStep(2);
      await check(d.rows, d.suggestedName || 'x', {}, {});
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  const check = async (r = rows, name = examName, cm = courseMap, bm = branchMap) => {
    setBusy(true);
    try {
      const { data: p } = await api.post('/exams/datesheet/commit', { rows: r, examName: name || 'x', courseMap: cm, branchMap: bm, mode, dryRun: true });
      setPlan(p); setError('');
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!examName.trim()) return setError('Enter a name for this exam session.');
    setBusy(true); setError('');
    try {
      const { data: r } = await api.post('/exams/datesheet/commit', payload({ skipInvalid: true }), { timeout: 300000 });
      setResult(r); setStep(3); onDone?.();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const delRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const errRows = useMemo(() => {
    const m = new Map();
    for (const i of plan?.issues || []) if (i.level === 'error') { if (!m.has(i.row)) m.set(i.row, []); m.get(i.row).push(i.message); }
    return m;
  }, [plan]);
  const warnRows = useMemo(() => {
    const m = new Map();
    for (const i of plan?.issues || []) if (i.level === 'warn') { if (!m.has(i.row)) m.set(i.row, []); m.get(i.row).push(i.message); }
    return m;
  }, [plan]);
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !onlyBad || errRows.has(r.row) || warnRows.has(r.row));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);
  const unmatchedC = (data?.maps.courses || []).filter((c) => !(courseMap[c.sheet] ? true : c.found));
  const unmatchedB = (data?.maps.branches || []).filter((b) => !(branchMap[`${b.course}|${b.sheet}`] !== undefined ? true : b.found));

  return (
    <Modal title="Upload datesheet" onClose={onClose} width={1100}>
      <div className="stack">
        {error && <div className="alert" role="alert">{error}</div>}

        {step === 1 && (
          <>
            <div className="alert info">
              Upload your datesheet as <b>Excel (.xlsx / .xls)</b> or <b>CSV</b>. Columns: Course, Branch, Year, Semester, Subject Code, Subject Name, Date, Shift, Duration.
              Exams are created automatically, one per course + year + semester.
            </div>
            <div className="row wrap">
              <a className="btn ghost sm" style={{ textDecoration: 'none' }} href="/api/exams/datesheet/template">Download Excel template</a>
              <a className="btn ghost sm" style={{ textDecoration: 'none' }} href="/api/exams/datesheet/template?format=csv">Download CSV template</a>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => upload(e.target.files[0])} disabled={busy} />
            {busy && <div className="muted">Reading file…</div>}
            <div className="muted small">
              Branch blank or "All" = every branch. "CSE, IT, AIML" creates a paper for each. Year "II/IV" with Semester "III/VII" creates both classes.
              Dates like 30-11-2026 work. Nothing is saved until you review and confirm.
            </div>
          </>
        )}

        {step === 2 && data && (
          <>
            <div className="form-grid">
              <Field label="Exam session name"><input className="input" value={examName} onChange={(e) => setExamName(e.target.value)} onBlur={() => check()} placeholder="End Term Nov-Dec 2026" /></Field>
              <Field label="If an exam already exists">
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="merge">Update it, keep its other papers</option>
                  <option value="replace">Replace its papers with this file</option>
                </select>
              </Field>
            </div>

            {plan && (
              <div className="stats">
                <div className="stat"><b>{rows.length}</b><span>Rows in file</span></div>
                <div className="stat"><b>{plan.exams}</b><span>Exams to create / update</span></div>
                <div className="stat"><b>{plan.papers}</b><span>Papers</span></div>
                <div className="stat"><b style={{ color: plan.rowsSkipped ? 'var(--danger)' : 'inherit' }}>{plan.rowsSkipped}</b><span>Rows with errors</span></div>
                <div className="stat"><b style={{ color: plan.classesWithoutStudents ? 'var(--warn)' : 'inherit' }}>{plan.classesWithoutStudents}</b><span>Classes with no students</span></div>
              </div>
            )}

            {(unmatchedC.length > 0 || unmatchedB.length > 0 || (data.maps.studentCourses.length === 0)) && (
              <details open className="card flat" style={{ padding: 14 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Match names to your student list ({unmatchedC.length + unmatchedB.length} not matched)</summary>
                {data.maps.studentCourses.length === 0 && <div className="muted small" style={{ marginTop: 8 }}>No students are imported yet, so names are used exactly as written. Import students first for automatic matching.</div>}
                <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                  {unmatchedC.map((c) => (
                    <div key={c.sheet} className="row wrap" style={{ gap: 8 }}>
                      <span style={{ minWidth: 200 }}>Course <b>{c.sheet}</b> <span className="muted small">({c.rows} rows)</span></span>
                      <select className="input" style={{ width: 220 }} value={courseMap[c.sheet] || ''} onChange={(e) => { const cm = { ...courseMap, [c.sheet]: e.target.value }; setCourseMap(cm); check(rows, examName, cm, branchMap); }}>
                        <option value="">Keep "{c.sheet}"</option>
                        {data.maps.studentCourses.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    </div>
                  ))}
                  {unmatchedB.map((b) => (
                    <div key={b.course + b.sheet} className="row wrap" style={{ gap: 8 }}>
                      <span style={{ minWidth: 200 }}>Branch <b>{b.sheet}</b> <span className="muted small">in {b.course}</span></span>
                      <input className="input" style={{ width: 220 }} placeholder="Branch name in student list" value={branchMap[`${b.course}|${b.sheet}`] ?? ''} onChange={(e) => setBranchMap({ ...branchMap, [`${b.course}|${b.sheet}`]: e.target.value })} onBlur={() => check()} />
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="row spread wrap" style={{ alignItems: 'center', marginTop: 10, marginBottom: 8, gap: 8 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <button
                  type="button"
                  className={`btn sm ${viewTab === 'classes' ? 'hi' : 'ghost'}`}
                  onClick={() => setViewTab('classes')}
                >
                  📅 Grouped by Class ({plan?.classPreview?.length || 0})
                </button>
                <button
                  type="button"
                  className={`btn sm ${viewTab === 'rows' ? 'hi' : 'ghost'}`}
                  onClick={() => setViewTab('rows')}
                >
                  📝 Raw Spreadsheet Rows ({rows.length})
                </button>
              </div>

              {viewTab === 'rows' ? (
                <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                  <label className="row" style={{ gap: 6, fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={onlyBad} onChange={(e) => { setOnlyBad(e.target.checked); setPage(0); }} />
                    Only problems ({errRows.size} err, {warnRows.size} warn)
                  </label>
                  <button className="btn ghost sm" onClick={() => check()} disabled={busy}>
                    {busy ? 'Checking…' : 'Re-check'}
                  </button>
                </div>
              ) : (
                <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="muted small">Course · Branch · Year · Semester</span>
                  <button className="btn ghost sm" onClick={() => check()} disabled={busy}>
                    {busy ? 'Checking…' : 'Refresh preview'}
                  </button>
                </div>
              )}
            </div>

            {viewTab === 'classes' ? (
              <ClassSchedulePreview classes={plan?.classPreview || []} maxHeight="46vh" />
            ) : (
              <>
                <div className="table-wrap" style={{ maxHeight: '46vh', overflow: 'auto' }}>
                  <table>
                    <thead><tr><th>#</th><th>Course</th><th>Branch</th><th>Year</th><th>Sem</th><th>Code</th><th>Subject</th><th>Date</th><th>Shift</th><th /></tr></thead>
                    <tbody>
                      {slice.map(({ r, i }) => {
                        const errs = errRows.get(r.row); const warns = warnRows.get(r.row);
                        const cell = (k, w, extra = {}) => <input className="input" style={{ width: w, padding: '4px 6px' }} value={r[k] ?? ''} onChange={(e) => setRow(i, { [k]: e.target.value })} onBlur={() => check()} {...extra} />;
                        return (
                          <React.Fragment key={i}>
                            <tr style={errs ? { background: '#fdeeea' } : warns ? { background: '#fff8e6' } : undefined}>
                              <td className="muted small">{r.row}</td>
                              <td>{cell('course', 110)}</td><td>{cell('branch', 110)}</td><td>{cell('year', 52)}</td><td>{cell('semester', 52)}</td><td>{cell('code', 90)}</td>
                              <td>{cell('subject', 240)}</td>
                              <td>{cell('date', 108, { placeholder: 'YYYY-MM-DD' })}</td>
                              <td><select className="input" style={{ padding: '4px 6px' }} value={r.shift} onChange={(e) => { setRow(i, { shift: e.target.value }); }} onBlur={() => check()}>{!SHIFT_OPTS.includes(r.shift) && <option value={r.shift}>{r.shift || '—'}</option>}{SHIFT_OPTS.map((s) => <option key={s}>{s}</option>)}</select></td>
                              <td><button className="btn danger sm" onClick={() => { delRow(i); setTimeout(() => check(rows.filter((_, j) => j !== i)), 0); }}>✕</button></td>
                            </tr>
                            {(errs || warns) && <tr style={errs ? { background: '#fdeeea' } : { background: '#fff8e6' }}><td /><td colSpan={9} className="small" style={{ color: errs ? 'var(--danger)' : 'var(--warn)' }}>{[...(errs || []), ...(warns || [])].join(' · ')}</td></tr>}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="row spread">
                  <span className="muted small">Rows {shown.length ? page * PAGE + 1 : 0}–{Math.min(shown.length, (page + 1) * PAGE)} of {shown.length}</span>
                  <div className="row"><button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button><button className="btn ghost sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
                </div>
              </>
            )}

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn hi" disabled={busy || !plan || !plan.papers} onClick={save}>
                {busy ? 'Working…' : `Create ${plan?.exams ?? ''} exams (${plan?.papers ?? ''} papers)${plan?.rowsSkipped ? `, skip ${plan.rowsSkipped} bad rows` : ''}`}
              </button>
            </div>
          </>
        )}

        {step === 3 && result && (
          <>
            <div className="alert ok" style={{ borderLeft: '4px solid #10b981' }}>
              <b>Exams created successfully!</b> {result.created} exams created, {result.updated} updated, {result.papers} papers scheduled across {(result.classPreview || plan?.classPreview || []).length} classes.
              {result.allocationsCleared ? ` ${result.allocationsCleared} seat allocations were cleared because those papers changed — re-run allocation.` : ''}
            </div>

            <div className="row spread wrap" style={{ alignItems: 'center', marginTop: 6 }}>
              <div>
                <h3 style={{ margin: 0 }}>Created Exam Schedule by Class</h3>
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  Organized by <b>Course · Branch · Year · Semester</b> with all respective subject exams and dates:
                </p>
              </div>
              <span className="badge ok" style={{ fontSize: '0.85rem' }}>
                {(result.classPreview || plan?.classPreview || []).length} Classes
              </span>
            </div>

            <ClassSchedulePreview classes={result.classPreview || plan?.classPreview || []} maxHeight="52vh" />

            <div className="row spread wrap" style={{ marginTop: 14 }}>
              <a href="/allocations" className="btn hi" style={{ textDecoration: 'none' }}>
                Proceed to Seating Allocation →
              </a>
              <button className="btn ghost" onClick={onClose}>
                Done / Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
