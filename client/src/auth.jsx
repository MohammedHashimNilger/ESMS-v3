import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, role: null, user: null });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setState({ loading: false, role: data.role, user: data.user });
    } catch {
      setState({ loading: false, role: null, user: null });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const login = async (path, body) => {
    const { data } = await api.post(path, body);
    setState({ loading: false, role: data.role, user: data.user });
    return data;
  };
  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setState({ loading: false, role: null, user: null });
  };

  return <Ctx.Provider value={{ ...state, login, logout, refresh, setUser: (user) => setState((s) => ({ ...s, user })) }}>{children}</Ctx.Provider>;
}
