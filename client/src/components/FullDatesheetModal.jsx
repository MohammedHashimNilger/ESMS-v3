import React, { useMemo, useState } from 'react';
import { Modal } from './ui.jsx';

const PrintIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: '-2px' }}>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

const DownloadIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: '-2px' }}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

function formatDMY(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d;
}

export default function FullDatesheetModal({ exams = [], onClose }) {
  const [courseFilter, setCourseFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('course'); // 'course' or 'date'

  // Flatten all exams and papers into a flat row list
  const allRows = useMemo(() => {
    const list = [];
    for (const ex of exams) {
      for (const en of ex.entries || []) {
        list.push({
          course: ex.course,
          branch: en.branch || '',
          year: ex.year,
          semester: ex.semester || '',
          code: en.code || '',
          subject: en.subject || '',
          date: en.date || '',
          shift: en.shift === 'Morning' ? 'M' : en.shift === 'Afternoon' ? 'A' : en.shift === 'Evening' ? 'E' : (en.shift || 'M'),
          rawShift: en.shift || 'Morning',
          duration: en.durationMin ? (en.durationMin >= 60 ? `${en.durationMin / 60} Hrs` : `${en.durationMin} Min`) : '3 Hrs',
        });
      }
    }
    return list;
  }, [exams]);

  const courses = useMemo(() => [...new Set(allRows.map((r) => r.course).filter(Boolean))].sort(), [allRows]);
  const branches = useMemo(() => {
    const subset = courseFilter ? allRows.filter((r) => r.course === courseFilter) : allRows;
    return [...new Set(subset.map((r) => r.branch).filter(Boolean))].sort();
  }, [allRows, courseFilter]);

  const filtered = useMemo(() => {
    let res = allRows;
    if (courseFilter) res = res.filter((r) => r.course === courseFilter);
    if (branchFilter) res = res.filter((r) => r.branch === branchFilter);
    if (shiftFilter) res = res.filter((r) => r.shift === shiftFilter || r.rawShift === shiftFilter);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      res = res.filter((r) =>
        r.subject.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.course.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q)
      );
    }

    if (sortBy === 'date') {
      res = [...res].sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift) || a.course.localeCompare(b.course));
    } else {
      res = [...res].sort((a, b) =>
        a.course.localeCompare(b.course) ||
        a.branch.localeCompare(b.branch) ||
        a.year - b.year ||
        (a.semester || 0) - (b.semester || 0) ||
        a.date.localeCompare(b.date)
      );
    }
    return res;
  }, [allRows, courseFilter, branchFilter, shiftFilter, search, sortBy]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal title="Full Datesheet" onClose={onClose} width={1200}>
      <div className="stack" style={{ gap: 14 }}>
        {/* Controls Toolbar (hidden on print) */}
        <div className="no-print row spread wrap" style={{ gap: 10, background: 'var(--surface-sunken, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid var(--border, #e2e8f0)' }}>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              style={{ width: 220, padding: '5px 8px', fontSize: '0.85rem' }}
              placeholder="Search subject or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input"
              style={{ width: 140, padding: '5px 8px', fontSize: '0.85rem' }}
              value={courseFilter}
              onChange={(e) => { setCourseFilter(e.target.value); setBranchFilter(''); }}
            >
              <option value="">All Courses ({courses.length})</option>
              {courses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              className="input"
              style={{ width: 140, padding: '5px 8px', fontSize: '0.85rem' }}
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="">All Branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              className="input"
              style={{ width: 110, padding: '5px 8px', fontSize: '0.85rem' }}
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
            >
              <option value="">All Shifts</option>
              <option value="M">Morning (M)</option>
              <option value="A">Afternoon (A)</option>
              <option value="E">Evening (E)</option>
            </select>
            <select
              className="input"
              style={{ width: 150, padding: '5px 8px', fontSize: '0.85rem' }}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="course">Sort: Course & Branch</option>
              <option value="date">Sort: Chronological Date</option>
            </select>
          </div>

          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <button className="btn hi sm" onClick={handlePrint}>
              <PrintIcon /> Print / Save PDF
            </button>
            <a className="btn ghost sm" style={{ textDecoration: 'none' }} href="/api/exams/datesheet/export">
              <DownloadIcon /> Excel
            </a>
            <a className="btn ghost sm" style={{ textDecoration: 'none' }} href="/api/exams/datesheet/export?format=csv">
              <DownloadIcon /> CSV
            </a>
          </div>
        </div>

        {/* Printable University Datesheet View */}
        <div id="full-datesheet-view" style={{ maxHeight: '68vh', overflowY: 'auto', background: '#fff', padding: '16px 20px', border: '1px solid #cbd5e1', borderRadius: 4 }}>
          {/* Datesheet Table in exact format */}
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #334155', fontSize: '0.82rem', fontFamily: 'inherit' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #334155' }}>
                <th style={{ border: '1px solid #64748b', padding: '6px 4px', textAlign: 'center', width: 44 }}>S.No.</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 8px', textAlign: 'left', width: 90 }}>Course</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 8px', textAlign: 'left', width: 110 }}>Branch</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 4px', textAlign: 'center', width: 50 }}>Year</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 4px', textAlign: 'center', width: 65 }}>Semester</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 8px', textAlign: 'left', width: 110 }}>Subject Code</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 8px', textAlign: 'left' }}>Subject Name</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 8px', textAlign: 'center', width: 95 }}>Date</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 4px', textAlign: 'center', width: 50 }}>Shift</th>
                <th style={{ border: '1px solid #64748b', padding: '6px 8px', textAlign: 'center', width: 75 }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #cbd5e1', background: i % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 4px', textAlign: 'center', fontWeight: 600, color: '#64748b' }}>
                    {i + 1}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 8px', fontWeight: 700 }}>
                    {r.course}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 8px' }}>
                    {r.branch || 'All'}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 4px', textAlign: 'center' }}>
                    {r.year}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 4px', textAlign: 'center' }}>
                    {r.semester || '—'}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {r.code || '—'}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 8px', fontWeight: 600 }}>
                    {r.subject}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {formatDMY(r.date)}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 4px', textAlign: 'center', fontWeight: 700, color: r.shift === 'M' ? '#0284c7' : r.shift === 'A' ? '#d97706' : '#7c3aed' }}>
                    {r.shift}
                  </td>
                  <td style={{ border: '1px solid #94a3b8', padding: '5px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {r.duration}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                    No exam papers found matching the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="no-print row spread" style={{ alignItems: 'center' }}>
          <span className="muted small">
            Showing {filtered.length} of {allRows.length} exam papers across {exams.length} exams.
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
