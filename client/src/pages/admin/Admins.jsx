import React, { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { Modal, Field, PageHead, useToast } from '../../components/ui.jsx';

export default function Admins() {
  const toast = useToast();
  const [admins, setAdmins] = useState([]);
  const [log, setLog] = useState([]);
  const [add, setAdd] = useState(null);
  const [reset, setReset] = useState(null);

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([api.get('/admins'), api.get('/admins/audit/log')]);
      setAdmins(a.data); setLog(l.data);
    } catch (e) { toast(errMsg(e), 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    try { await api.post('/admins', add); toast('Admin created.'); setAdd(null); load(); } catch (e2) { toast(errMsg(e2), 'error'); }
  };
  const doReset = async (e) => {
    e.preventDefault();
    try { await api.put(`/admins/${reset._id}/password`, { password: reset.password }); toast('Password reset.'); setReset(null); } catch (e2) { toast(errMsg(e2), 'error'); }
  };
  const del = async (a) => {
    if (!window.confirm(`Remove admin ${a.email}?`)) return;
    try { await api.delete(`/admins/${a._id}`); toast('Admin removed.'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <>
      <PageHead title="Admins & audit log" sub="Only the super admin can see this page.">
        <button className="btn" onClick={() => setAdd({ name: '', email: '', password: '' })}>+ Add admin</button>
      </PageHead>
      <div className="card flat">
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
          <tbody>{admins.map((a) => (
            <tr key={a._id}>
              <td><b>{a.name}</b></td><td>{a.email}</td>
              <td>{a.role === 'superadmin' ? <span className="badge warn">Super admin</span> : <span className="badge">Admin</span>}</td>
              <td className="right nowrap">
                {a.role !== 'superadmin' && <><button className="btn ghost sm" onClick={() => setReset({ ...a, password: '' })}>Reset password</button>{' '}<button className="btn danger sm" onClick={() => del(a)}>Remove</button></>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>

      <h2 style={{ margin: '28px 0 12px' }}>Recent activity</h2>
      <div className="card flat">
        <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>{log.map((l) => <tr key={l._id}><td className="nowrap">{new Date(l.createdAt).toLocaleString('en-IN')}</td><td>{l.actorName}</td><td><span className="badge">{l.action}</span></td><td className="small">{l.details}</td><td className="small muted">{l.ip}</td></tr>)}</tbody>
        </table></div>
        {!log.length && <div className="empty">No activity yet.</div>}
      </div>

      {add && (
        <Modal title="Add admin" onClose={() => setAdd(null)} width={460}>
          <form className="stack" onSubmit={create}>
            <Field label="Name"><input className="input" required value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" required value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
            <Field label="Temporary password (8+ chars, letter + number)"><input className="input" type="password" required minLength={8} value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} /></Field>
            <button className="btn">Create admin</button>
          </form>
        </Modal>
      )}
      {reset && (
        <Modal title={`Reset password · ${reset.email}`} onClose={() => setReset(null)} width={440}>
          <form className="stack" onSubmit={doReset}>
            <Field label="New password"><input className="input" type="password" required minLength={8} value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} /></Field>
            <button className="btn">Reset password</button>
          </form>
        </Modal>
      )}
    </>
  );
}
