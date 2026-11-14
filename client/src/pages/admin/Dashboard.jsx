import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../../api';
import { PageHead, todayStr, fmtDate } from '../../components/ui.jsx';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/dashboard', { params: { date: todayStr() } }).then((r) => setD(r.data)).catch((e) => setErr(errMsg(e))); }, []);
  if (err) return <div className="alert">{err}</div>;
  if (!d) return <div className="empty">Loading…</div>;
  const s = d.stats;
  return (
    <>
      <PageHead title="Dashboard" sub={fmtDate(d.today)} />
      <div className="stats">
        <div className="stat"><b>{s.students.toLocaleString()}</b><span>Students on record</span></div>
        <div className="stat"><b>{s.registered.toLocaleString()}</b><span>Registered accounts</span></div>
        <div className="stat"><b>{s.rooms}</b><span>Active exam rooms</span></div>
        <div className="stat"><b>{s.seats.toLocaleString()}</b><span>Usable seats</span></div>
        <div className="stat"><b>{s.exams}</b><span>Exams created</span></div>
      </div>

      <div className="card flat" style={{ marginTop: 22 }}>
        <div style={{ padding: '16px 20px' }}><h2>Today’s papers</h2></div>
        {d.slots.length === 0 ? <div className="empty">No papers scheduled today.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Shift</th><th>Exam</th><th>Class</th><th>Subject</th><th>Seated</th></tr></thead>
            <tbody>{d.slots.map((x, i) => (
              <tr key={i}><td><span className="badge">{x.shift}</span></td><td>{x.exam}</td><td>{x.course} Y{x.year}{x.branch ? ` · ${x.branch}` : ''}</td><td><b>{x.subject}</b></td>
                <td>{x.seated ? <span className="badge ok">{x.seated} in {x.rooms} rooms</span> : <Link to="/admin/allocation"><span className="badge warn">Not allocated</span></Link>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card flat" style={{ marginTop: 22 }}>
        <div style={{ padding: '16px 20px' }}><h2>Upcoming exams</h2></div>
        {d.upcoming.length === 0 ? <div className="empty">Nothing upcoming. <Link to="/admin/exams">Create an exam</Link></div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Exam</th><th>Class</th><th>Dates</th></tr></thead>
            <tbody>{d.upcoming.map((x) => <tr key={x._id}><td><b>{x.name}</b></td><td>{x.course} · Year {x.year}</td><td>{fmtDate(x.startDate)} → {fmtDate(x.endDate)}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
