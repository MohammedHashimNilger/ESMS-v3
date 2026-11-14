
## Changes in this version
- **Datesheet upload (Exams page):** upload Excel/CSV, review rows, exams are created per course + year + semester. Template downloads are on the upload screen.
- **Whole-period seating (Allocation page):** choose the exam period once. Every student gets one room + seat for every paper. Courses that write in a common shift never share seats; courses in different shifts may reuse the same room.
- **Door sheets:** one per room and shift (printed once if the same courses sit in the same seats in both shifts). Each seat shows seat number, name and MUR; the legend shows each course's date range. A4 landscape.
- **Choose rooms for courses:** pick rooms per course for the whole period; the rest is automatic. Optional: use empty columns if rooms run short, save partial.
- **Seat edits:** move to another room, or swap; changes apply to all papers of the student.

## Staff login address
The admin login page is not linked anywhere and `/admin/login` no longer exists. Staff open the secret address set in `client/.env` (`VITE_ADMIN_LOGIN_PATH`, default `/staff-access-4f9k2`). Copy `client/.env.example` to `client/.env`, choose your own value and rebuild the client.

## Student email removed
Students no longer have an email. Signup needs only name + MUR (matched with the uploaded student list) and a password. The student upload template has no Email column (an Email column in an old file is ignored). Old email values already stored in the database are unused; to delete them run in mongosh: `db.students.updateMany({}, { $unset: { email: 1 } })`. Admin accounts still log in with email.

## Seating plan download
"Export CSV" on the Seating page gives one row per student for the whole period: Name, MUR, Course, Branch, Semester, Year, Building, Room, Floor, Seat (sorted by building, floor, room, seat). No date, shift or subject.
