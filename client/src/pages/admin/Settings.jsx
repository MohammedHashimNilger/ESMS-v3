import React, { useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { useAuth } from '../../auth.jsx';
import { Field, PageHead, useToast, SHIFTS } from '../../components/ui.jsx';

export default function Settings() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [p, setP] = useState({ name: user.name, email: user.email, currentPassword: '', newPassword: '', confirm: '' });
  const [shifts, setShifts] = useState(null);

  useEffect(() => { api.get('/settings/shifts').then((r) => setShifts(r.data)); }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (p.newPassword && p.newPassword !== p.confirm) return toast('New passwords do not match.', 'error');
    try {
      const { data } = await api.put('/auth/admin/profile', { name: p.name, email: p.email, currentPassword: p.currentPassword, newPassword: p.newPassword });
      setUser(data.user); setP({ ...p, currentPassword: '', newPassword: '', confirm: '' }); toast('Credentials updated.');
    } catch (e2) { toast(errMsg(e2), 'error'); }
  };
  const saveShifts = async (e) => {
    e.preventDefault();
    try { await api.put('/settings/shifts', shifts); toast('Shift timings saved.'); } catch (e2) { toast(errMsg(e2), 'error'); }
  };
  const setTime = (s, k) => (e) => setShifts((x) => ({ ...x, [s]: { ...x[s], [k]: e.target.value } }));

  return (
    <>
      <PageHead title="Settings" />
      <div className="card" style={{ marginBottom: 20, maxWidth: 640 }}>
        <h2 style={{ marginBottom: 4 }}>My account</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Change your name, email or password{user.role === 'superadmin' ? ' (including the seeded super admin credentials)' : ''}. The current password is needed to change email or password.</p>
        <form className="stack" onSubmit={saveProfile}>
          <div className="form-grid">
            <Field label="Name"><input className="input" required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="Email (login)"><input className="input" type="email" required value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={p.currentPassword} onChange={(e) => setP({ ...p, currentPassword: e.target.value })} /></Field>
            <Field label="New password (optional)"><input className="input" type="password" autoComplete="new-password" minLength={8} value={p.newPassword} onChange={(e) => setP({ ...p, newPassword: e.target.value })} /></Field>
            <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" value={p.confirm} onChange={(e) => setP({ ...p, confirm: e.target.value })} /></Field>
          </div>
          <div><button className="btn">Save changes</button></div>
        </form>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <h2 style={{ marginBottom: 12 }}>Shift timings</h2>
        {shifts && (
          <form className="stack" onSubmit={saveShifts}>
            {SHIFTS.map((s) => (
              <div key={s} className="row wrap"><b style={{ width: 100 }}>{s}</b>
                <input className="input" style={{ width: 140 }} type="time" required value={shifts[s].start} onChange={setTime(s, 'start')} />
                <span>to</span>
                <input className="input" style={{ width: 140 }} type="time" required value={shifts[s].end} onChange={setTime(s, 'end')} />
              </div>
            ))}
            <div><button className="btn">Save timings</button></div>
          </form>
        )}
      </div>
    </>
  );
}
