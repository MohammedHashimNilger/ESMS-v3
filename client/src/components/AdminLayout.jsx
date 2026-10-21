import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const LINKS = [
  ['/admin', 'Dashboard', true], ['/admin/students', 'Students'], ['/admin/rooms', 'Exam rooms'],
  ['/admin/exams', 'Exams'], ['/admin/allocation', 'Allocation'], ['/admin/seating', 'Seating plans'],
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const links = [...LINKS, ...(user.role === 'superadmin' ? [['/admin/admins', 'Admins & audit']] : []), ['/admin/settings', 'Settings']];

  return (
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand"><i />ESMS</div>
        {links.map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
        <div className="who">
          <div><b>{user.name}</b></div>
          <div>{user.role === 'superadmin' ? 'Super admin' : 'Admin'}</div>
          <button className="btn ghost sm" style={{ marginTop: 10, color: '#fff', borderColor: '#ffffff44' }} onClick={async () => { await logout(); nav('/admin/login'); }}>Log out</button>
        </div>
      </aside>
      <main className="main">
        <button className="btn ghost sm menu-btn" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>☰ Menu</button>
        <Outlet />
      </main>
    </div>
  );
}
