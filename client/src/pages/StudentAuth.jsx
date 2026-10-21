import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { errMsg } from '../api';

export function AuthArt({ title, text }) {
  // decorative mini seat grid with one highlighted seat
  const seats = Array.from({ length: 60 }, (_, i) => (i === 27 ? 'me' : (Math.floor(i / 6) % 2 === 0 ? 'b' : '')));
  return (
    <div className="auth-art">
      <div className="brand" style={{ padding: 0 }}><i />ESMS</div>
      <div><h1>{title}</h1><p>{text}</p></div>
      <div className="mini-grid" aria-hidden="true">{seats.map((c, i) => <span key={i} className={c} />)}</div>
    </div>
  );
}

export default function StudentAuth({ mode }) {
  const { login, role } = useAuth();
  const nav = useNavigate();
  const isSignup = mode === 'signup';
  const [f, setF] = useState({ name: '', enrollmentNo: '', email: '', password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (role === 'student') return <Navigate to="/student" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (isSignup && f.password !== f.confirm) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      if (isSignup) await login('/auth/student/signup', { name: f.name, enrollmentNo: f.enrollmentNo, email: f.email, password: f.password });
      else await login('/auth/student/login', { enrollmentNo: f.enrollmentNo, password: f.password });
      nav('/student');
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <AuthArt title="Find your seat before exam day." text="Log in with your MUR number to see your room, floor, seat and the exact subject and shift of every paper." />
      <div className="auth-form">
        <form onSubmit={submit}>
          <div className="tabs" role="tablist">
            <button type="button" className={!isSignup ? 'on' : ''} onClick={() => nav('/login')}>Log in</button>
            <button type="button" className={isSignup ? 'on' : ''} onClick={() => nav('/signup')}>Sign up</button>
          </div>
          <h2>{isSignup ? 'Create your student account' : 'Welcome back'}</h2>
          {err && <div className="alert" role="alert">{err}</div>}
          {isSignup && <label className="field">Full name (as on university records)<input className="input" value={f.name} onChange={set('name')} required maxLength={100} autoComplete="name" /></label>}
          <label className="field">MUR / Enrollment number<input className="input" value={f.enrollmentNo} onChange={set('enrollmentNo')} required maxLength={30} autoComplete="username" /></label>
          {isSignup && <label className="field">Email<input className="input" type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>}
          <label className="field">Password<input className="input" type="password" value={f.password} onChange={set('password')} required minLength={isSignup ? 8 : 1} maxLength={72} autoComplete={isSignup ? 'new-password' : 'current-password'} /></label>
          {isSignup && <label className="field">Confirm password<input className="input" type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></label>}
          {isSignup && <div className="muted small">Use at least 8 characters with a letter and a number. Your details must match the university's student list.</div>}
          <button className="btn" disabled={busy}>{busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}</button>
          <div className="small muted">Exam cell staff? <Link to="/admin/login">Admin login</Link></div>
        </form>
      </div>
    </div>
  );
}
