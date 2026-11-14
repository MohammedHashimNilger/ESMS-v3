const router = require('express').Router();
const Setting = require('../models/Setting');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../utils/audit');
const { protect } = require('../middleware/auth');
const { SHIFTS } = require('../utils/common');

router.get('/shifts', protect(), asyncHandler(async (_req, res) => res.json(await Setting.getShifts())));

router.put('/shifts', protect('admin'), asyncHandler(async (req, res) => {
  const out = {};
  for (const s of SHIFTS) {
    const v = req.body[s];
    if (!v || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.end) || v.start >= v.end) {
      throw new HttpError(400, `${s}: enter valid start and end times (start must be before end).`);
    }
    out[s] = { start: v.start, end: v.end };
  }
  await Setting.findOneAndUpdate({ key: 'shifts' }, { value: out }, { upsert: true });
  audit(req, 'SHIFTS_UPDATED');
  res.json(out);
}));

module.exports = router;
