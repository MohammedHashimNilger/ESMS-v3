import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { errMsg } from '../api';
import { AuthArt } from './StudentAuth.jsx';

export default function AdminLogin() {
  const { login, role } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'student') return <Navigate to="/student" replace />;

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login('/auth/admin/login', f); nav('/admin'); }
    catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <AuthArt title="Exam cell control room." text="Manage students, rooms, papers and seating for the whole university from one place." />
      <div className="auth-form">
        <form onSubmit={submit}>
          <h2>Admin sign in</h2>
          {err && <div className="alert" role="alert">{err}</div>}
          <label className="field">Email<input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="username" /></label>
          <label className="field">Password<input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required autoComplete="current-password" /></label>
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="small muted">Admin accounts are created by the super admin. <Link to="/login">Student login</Link></div>
        </form>
      </div>
    </div>
  );
}
