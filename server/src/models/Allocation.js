const mongoose = require("mongoose");
const { SHIFTS } = require("../utils/common");

const S = mongoose.Schema.Types;

// One document = one student's seat for one date + shift.
// Student and room details are copied in (snapshot) so listing/filtering 5,000+
// seats never needs joins and stays fast.
const allocationSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    shift: { type: String, enum: SHIFTS, required: true },
    shiftOrder: { type: Number, required: true },
    exam: { type: S.ObjectId, ref: "Exam", required: true },
    entryId: { type: S.ObjectId, required: true },
    subject: { type: String, required: true },
    student: { type: S.ObjectId, ref: "Student", required: true },
    studentName: String,
    enrollmentNo: String,
    course: String,
    branch: String,
    year: Number,
    semester: Number,
    group: String,
    room: { type: S.ObjectId, ref: "Room", required: true },
    roomName: String,
    building: String,
    floor: Number,
    seatNumber: { type: Number, required: true },
    row: Number,
    col: Number,
  },
  { timestamps: true },
);

allocationSchema.index({ date: 1, shift: 1, student: 1 }, { unique: true }); // one seat per student per slot
allocationSchema.index(
  { date: 1, shift: 1, room: 1, seatNumber: 1 },
  { unique: true },
); // one student per seat
allocationSchema.index({ student: 1, date: 1 }); // student dashboard
allocationSchema.index({ room: 1 });
allocationSchema.index({ exam: 1, entryId: 1 });
allocationSchema.index({
  date: 1,
  shiftOrder: 1,
  building: 1,
  roomName: 1,
  seatNumber: 1,
});
allocationSchema.index({ year: 1, course: 1, branch: 1, semester: 1 });
allocationSchema.index({ enrollmentNo: 1 });

module.exports = mongoose.model("Allocation", allocationSchema);
