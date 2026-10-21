module.exports = (err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong.';

  if (err.name === 'ValidationError') { status = 400; message = Object.values(err.errors).map((e) => e.message).join(' '); }
  else if (err.code === 11000) { status = 409; message = 'A record with the same unique value already exists.'; }
  else if (err.name === 'CastError') { status = 400; message = 'Invalid value supplied.'; }
  else if (err.name === 'MulterError') { status = 400; message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : err.message; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Request body too large.'; }

  if (status >= 500) { console.error(err); message = 'Internal server error.'; } // never leak internals
  res.status(status).json({ message, ...(err.details ? { details: err.details } : {}) });
};
