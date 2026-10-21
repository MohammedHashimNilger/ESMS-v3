// Creates 4,800 demo students + 60 rooms + a sample exam so you can test at realistic scale.
require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');
const Room = require('./models/Room');
const Exam = require('./models/Exam');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const plan = [['B.Tech', 'CSE', 1, 1, 1200], ['B.Tech', 'ECE', 1, 1, 1000], ['B.Tech', 'ME', 1, 1, 900], ['B.Tech', 'CE', 1, 1, 700], ['BCA', 'Computer Applications', 1, 1, 600], ['B.Tech', 'CSE', 2, 3, 400]];
  const first = ['Aarav', 'Riya', 'Vivaan', 'Ananya', 'Aditya', 'Diya', 'Kabir', 'Isha', 'Rohan', 'Meera', 'Arjun', 'Sana'];
  const last = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Meena', 'Jain', 'Agarwal', 'Rathore', 'Shekhawat', 'Khan'];
  const docs = []; let n = 1;
  for (const [course, branch, year, semester, count] of plan) {
    for (let i = 0; i < count; i++, n++) {
      docs.push({ name: `${first[n % first.length]} ${last[(n * 7) % last.length]}`, enrollmentNo: `MUR${String(n).padStart(6, '0')}`, course, branch, year, semester, isRegistered: false });
    }
  }
  await Student.deleteMany({ enrollmentNo: /^MUR\d{6}$/ });
  for (let i = 0; i < docs.length; i += 1000) await Student.insertMany(docs.slice(i, i + 1000), { ordered: false });
  console.log(`${docs.length} students created (not registered: sign up with MUR000001 + the printed name).`);
  console.log('Example signup -> name:', docs[0].name, '| MUR:', docs[0].enrollmentNo);

  await Room.deleteMany({ building: 'Demo Block' });
  const rooms = Array.from({ length: 60 }, (_, i) => ({ name: `Room ${101 + (i % 20)}`, building: `Demo Block ${Math.floor(i / 20) + 1}`, floor: Math.floor((i % 20) / 7), rows: 10, columns: 8, disabledSeats: [] }));
  await Room.deleteMany({ building: /^Demo Block/ });
  await Room.insertMany(rooms);
  console.log(`${rooms.length} rooms created (80 seats each).`);

  const day = (d) => `2026-11-${String(d).padStart(2, '0')}`;
  await Exam.deleteMany({ name: 'Demo Mid-Term (B.Tech Year 1)' });
  await Exam.create({
    name: 'Demo Mid-Term (B.Tech Year 1)', course: 'B.Tech', year: 1, semester: 1, startDate: day(2), endDate: day(6),
    entries: [['DSA', 2, 'Morning'], ['Engineering Maths', 3, 'Afternoon'], ['Physics', 4, 'Morning'], ['Basic Electrical', 5, 'Evening']].map(([subject, d, shift]) => ({ date: day(d), shift, subject, branch: '' })),
  });
  console.log('Demo exam created. Go to Allocation and run it.');
  process.exit(0);
})();
