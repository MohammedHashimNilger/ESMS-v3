const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },       // e.g. "Room 119"
  building: { type: String, required: true, trim: true, maxlength: 60 },   // e.g. "Main Building"
  floor: { type: Number, required: true, min: 0, max: 30, default: 0 },    // 0 = ground floor
  rows: { type: Number, required: true, min: 1, max: 40 },
  columns: { type: Number, required: true, min: 1, max: 40 },
  disabledSeats: { type: [Number], default: [] },                          // broken / reserved seat numbers
  isActive: { type: Boolean, default: true },
}, { timestamps: true, toJSON: { virtuals: true, versionKey: false } });

roomSchema.index({ building: 1, name: 1 }, { unique: true });
roomSchema.virtual('capacity').get(function () { return this.rows * this.columns - this.disabledSeats.length; });

module.exports = mongoose.model('Room', roomSchema);
