// Secret address of the staff login page. Change it in client/.env (VITE_ADMIN_LOGIN_PATH) and rebuild.
// Students are never shown a link to it, and /admin/login no longer exists.
const raw = (import.meta.env.VITE_ADMIN_LOGIN_PATH || 'staff-access-4f9k2').replace(/^\/+/, '');
export const ADMIN_LOGIN_PATH = `/${raw}`;
