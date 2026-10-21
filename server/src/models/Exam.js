const mongoose = require("mongoose");
const { SHIFTS } = require("../utils/common");

const entrySchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD
  shift: { type: String, enum: SHIFTS, required: true },
  subject: { type: String, required: true, trim: true, maxlength: 120 },
  branch: { type: String, default: "", trim: true }, // '' = every branch
});

const examSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    course: { type: String, required: true, trim: true },
    year: { type: Number, required: true, min: 1, max: 8 },
    semester: { type: Number, min: 1, max: 16, default: null }, // null = all semesters of that year
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    entries: { type: [entrySchema], default: [] },
  },
  { timestamps: true },
);

examSchema.index({ "entries.date": 1, "entries.shift": 1 });
examSchema.index({ startDate: -1 });

module.exports = mongoose.model("Exam", examSchema);
