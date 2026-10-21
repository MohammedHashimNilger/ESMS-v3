const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
});
const Setting = mongoose.model('Setting', settingSchema);

const DEFAULT_SHIFTS = {
  Morning: { start: '09:00', end: '12:00' },
  Afternoon: { start: '13:00', end: '16:00' },
  Evening: { start: '17:00', end: '20:00' },
};

Setting.getShifts = async () => {
  const doc = await Setting.findOne({ key: 'shifts' }).lean();
  return doc ? doc.value : DEFAULT_SHIFTS;
};

module.exports = Setting;
module.exports.DEFAULT_SHIFTS = DEFAULT_SHIFTS;
