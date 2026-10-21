// Strips Mongo operators ($gt, $ne, ...) and dotted keys from user input (NoSQL-injection defence).
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      if (k.startsWith('$') || k.includes('.')) continue;
      out[k] = clean(v[k]);
    }
    return out;
  }
  return v;
}
module.exports = (req, _res, next) => {
  if (req.body) req.body = clean(req.body);
  if (req.query) req.query = clean(req.query);
  if (req.params) req.params = clean(req.params);
  next();
};
