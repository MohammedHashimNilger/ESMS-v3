import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, message, type }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">{items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}</div>
    </ToastCtx.Provider>
  );
}

// ---------- modal ----------
export function Modal({ title, onClose, width = 640, children }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ '--w': `${width}px` }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <label className="field">{label}{children}</label>;
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      <div className="row wrap">{children}</div>
    </div>
  );
}

export function Pager({ page, pages, total, onPage }) {
  return (
    <div className="pager">
      <span className="muted small">{total.toLocaleString()} records</span>
      <button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className="small">Page {page} of {Math.max(pages, 1)}</span>
      <button className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ---------- helpers ----------
export const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the user's timezone
export const SHIFTS = ['Morning', 'Afternoon', 'Evening'];
export const floorLabel = (f) => (f === 0 ? 'Ground floor' : `${f}${['th', 'st', 'nd', 'rd'][f % 100 > 3 && f % 100 < 21 ? 0 : f % 10 <= 3 ? f % 10 : 0]} floor`);
export const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
export const yearLabel = (y) => `Year ${y}`;
