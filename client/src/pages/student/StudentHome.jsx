import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMsg } from '../../api';
import { useAuth } from '../../auth.jsx';
import RoomGrid from '../../components/RoomGrid.jsx';
import { Modal, Field, useToast, todayStr, fmtDate, fmtTime, floorLabel } from '../../components/ui.jsx';

export default function StudentHome() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [pw, setPw] = useState(null);

  useEffect(() => {
    api.get('/me/overview').then(({ data }) => {
      setData(data);
      const t = todayStr();
      const idx = data.exams.findIndex((e) => e.date >= t); // today's paper, else the next one
      setSel(idx >= 0 ? data.exams[idx]._id : data.exams.at(-1)?._id || null);
    }).catch((e) => setErr(errMsg(e)));
  }, []);

  const exam = useMemo(() => data?.exams.find((e) => e._id === sel), [data, sel]);
  const today = todayStr();

  const changePw = async (e) => {
    e.preventDefault();
    try { await api.put('/auth/student/password', pw); toast('Password updated.'); setPw(null); } catch (e2) { toast(errMsg(e2), 'error'); }
  };

  if (err) return <div className="s-wrap"><div className="alert">{err}</div></div>;
  if (!data) return <div className="empty">Loading your details…</div>;
  const s = data.student;

  return (
    <div className="s-wrap">
      <div className="s-top no-print">
        <div className="brand" style={{ color: 'var(--ink)', padding: 0 }}><i />ESMS</div>
        <div className="row">
          {exam && <button className="btn hi sm" onClick={() => window.print()}>Print seat slip</button>}
          <button className="btn ghost sm" onClick={() => setPw({ currentPassword: '', newPassword: '' })}>Change password</button>
          <button className="btn ghost sm" onClick={async () => { await logout(); nav('/login'); }}>Log out</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginBottom: 14 }}>{s.name}</h2>
        <dl className="kv" style={{ margin: 0 }}>
          <div><dt>MUR</dt><dd>{s.enrollmentNo}</dd></div>
          <div><dt>Course</dt><dd>{s.course}</dd></div>
          <div><dt>Branch</dt><dd>{s.branch}</dd></div>
          <div><dt>Year</dt><dd>{s.year}</dd></div>
          <div><dt>Semester</dt><dd>{s.semester}</dd></div>
        </dl>
      </div>

      {!data.exams.length && <div className="card empty">No seat has been allotted to you yet. Check back once the exam cell publishes the seating plan.</div>}

      {exam && (
        <>
          <div className="ticket">
            <div className="l">
              <div className="kicker">{exam.date === today ? 'Today’s paper' : exam.date > today ? 'Upcoming paper' : 'Past paper'}</div>
              <h2>{exam.subject}</h2>
              <dl className="kv" style={{ margin: 0 }}>
                <div><dt>Date</dt><dd>{fmtDate(exam.date)}</dd></div>
                <div><dt>Shift</dt><dd>{exam.shift}{exam.time ? ` · ${fmtTime(exam.time.start)} – ${fmtTime(exam.time.end)}` : ''}</dd></div>
                <div><dt>Room</dt><dd>{exam.room.name}</dd></div>
                <div><dt>Building</dt><dd>{exam.room.building}</dd></div>
                <div><dt>Floor</dt><dd>{floorLabel(exam.room.floor)}</dd></div>
                <div><dt>Position</dt><dd>Row {exam.row}, Column {exam.col}</dd></div>
              </dl>
            </div>
            <div className="r">
              <div className="kicker">Your seat number</div>
              <div className="seatno">{exam.seatNumber}</div>
              <div><b>{exam.room.name}</b> · {floorLabel(exam.room.floor)}</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 4 }}>Your seat in {exam.room.name}</h3>
            <p className="muted small" style={{ marginTop: 0 }}>The glowing yellow seat is yours. Seats are numbered downwards, column by column.</p>
            <RoomGrid rows={exam.room.rows} columns={exam.room.columns} disabled={exam.room.disabledSeats} occupied={exam.occupied} mySeat={exam.seatNumber} />
          </div>

          <div className="card no-print" style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 12 }}>All your papers</h3>
            <div className="stack" style={{ gap: 8 }}>
              {data.exams.map((x) => (
                <button key={x._id} className={`sched-item${x._id === sel ? ' on' : ''}`} onClick={() => setSel(x._id)}>
                  <span><b>{x.subject}</b><br /><span className="muted small">{fmtDate(x.date)} · {x.shift}</span></span>
                  <span className="right"><b>{x.room.name}</b><br /><span className="muted small">Seat {x.seatNumber}</span></span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {pw && (
        <Modal title="Change password" onClose={() => setPw(null)} width={420}>
          <form className="stack" onSubmit={changePw}>
            <Field label="Current password"><input className="input" type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password (8+ chars, letter + number)"><input className="input" type="password" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <button className="btn">Update password</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
