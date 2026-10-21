import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import StudentAuth from './pages/StudentAuth.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import StudentHome from './pages/student/StudentHome.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Students from './pages/admin/Students.jsx';
import Rooms from './pages/admin/Rooms.jsx';
import Exams from './pages/admin/Exams.jsx';
import Allocation from './pages/admin/Allocation.jsx';
import Seating from './pages/admin/Seating.jsx';
import Admins from './pages/admin/Admins.jsx';
import Settings from './pages/admin/Settings.jsx';

function Guard({ role, children }) {
  const { loading, role: current } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  if (current !== role) return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} replace />;
  return children;
}

function Home() {
  const { loading, role } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  return <Navigate to={role === 'admin' ? '/admin' : role === 'student' ? '/student' : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<StudentAuth mode="login" />} />
      <Route path="/signup" element={<StudentAuth mode="signup" />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/student" element={<Guard role="student"><StudentHome /></Guard>} />
      <Route path="/admin" element={<Guard role="admin"><AdminLayout /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="rooms" element={<Rooms />} />
        <Route path="exams" element={<Exams />} />
        <Route path="allocation" element={<Allocation />} />
        <Route path="seating" element={<Seating />} />
        <Route path="admins" element={<Admins />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
