import axios from 'axios';

const api = axios.create({ baseURL: '/api', withCredentials: true, timeout: 60000 });
export const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong.';
export default api;
