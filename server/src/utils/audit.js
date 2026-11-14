const AuditLog = require('../models/AuditLog');

// Fire-and-forget: never slows or breaks a request.
module.exports = function audit(req, action, details = '') {
  AuditLog.create({
    actor: req.user && req.user._id,
    actorName: req.user && (req.user.name || req.user.email),
    action,
    details: String(details).slice(0, 500),
    ip: req.ip,
  }).catch((e) => console.error('audit failed', e.message));
};
