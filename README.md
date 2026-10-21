# ESMS — University Exam & Seating Management (MERN)

Admin panel + student panel. Students sign up against an admin-uploaded master list, admins create rooms/exams and
auto-allocate seats, students see only their own seat on a highlighted room grid.

## Run it (5 minutes)

Prerequisites: Node 18+ and MongoDB running locally (or an Atlas URI).

```bash
# 1) API
cd server
cp .env.example .env          # then edit JWT_SECRET (32+ random chars) and the SEED_ADMIN_* values
npm install
npm run seed                  # creates the super admin
npm run seed:demo             # OPTIONAL: 4,800 demo students, 60 rooms, 1 demo exam (to test at scale)
npm run dev                   # http://localhost:5000

# 2) Web app (new terminal)
cd client
npm install
npm run dev                   # http://localhost:5173  (proxies /api to :5000)
```

* Admin login: `/admin/login` with the SEED_ADMIN_EMAIL / PASSWORD. **Settings → My account** lets the super admin change its own name, email and password.
* Student login: `/login`. After `seed:demo`, sign up at `/signup` using a name + MUR printed by the script (e.g. MUR000001).
* Quick test of the allocation algorithm alone (no DB): `cd server && npm run test:allocator`

## Flow

1. **Admin → Students → Import**: upload CSV/Excel (`Name, Enrollment No, Email, Course, Branch, Year, Semester`).
2. **Students sign up** with name + MUR + email + password. Name must match the list (and email, if the list has one).
3. **Admin → Exam rooms**: building, room, floor, rows × columns; click seats to disable broken ones.
4. **Admin → Exams**: class, date range, then papers (date, shift, subject, optional branch).
5. **Admin → Allocation**: preview per date+shift, choose rooms (optional), allocate. "Allocate all pending" does every slot.
6. **Admin → Seating plans**: filter by date/shift/course/branch/year/semester/name, export CSV, or open any room's full seat grid
   (names on every seat, click a student then an empty seat to move them, print a seating sheet).
7. **Student panel**: profile, today's/next paper, room + building + floor + seat number, room grid with their seat glowing, all papers, print slip.

## Rules I implemented (tell me if you want any changed)

* A "class" = course + branch + year + semester. Classes are sorted so the same class fills neighbouring rooms.
* Each room holds at most **two classes**: class A in odd columns (1, 3, 5…), class B in even columns (2, 4, 6…).
* **Strict rule**: if only one class is left, the even columns stay empty (uses more rooms).
* Seat numbers run **down each column** (1…rows in column 1, then column 2…).
* Allocation is per **date + shift across all exams**, so a room can never be double-booked in a slot.
* Not enough seats → nothing is saved and you see exactly how many students are unseated.
* Debarred students are skipped. Disabled seats are never used.
* Editing an exam clears only the allocations that became invalid; room layout can't change while students are seated in it.

## Security

| Area | What is in place |
|---|---|
| Passwords | bcrypt (cost 12), policy: 8–72 chars, letter + number |
| Sessions | JWT in **httpOnly, SameSite=Lax, Secure (prod)** cookie, 1-day expiry; changing a password invalidates older sessions |
| Brute force | per-IP rate limits on login/signup + 5 failures → 15-minute account lock + global API limiter |
| Access control | role checks on every route (student / admin / super admin); students can only read their own seat; no public admin signup |
| Injection | Mongo-operator stripping on all input, typed validation, regex escaping in searches, CSV export neutralises spreadsheet formulas |
| Headers | Helmet (CSP, no-sniff, frameguard…), CORS locked to `CLIENT_ORIGIN`, body size limits, upload size/type limits |
| Privacy | students never receive other students' names — other occupied seats are sent as bare numbers |
| Accountability | audit log of admin actions (login, imports, allocation, edits), kept one year |
| Errors | no stack traces/internals leak to the client |

## Scalability (designed for 5,000+ students, comfortable at 50,000+)

* Every list endpoint is **server-side paginated** (max 100/page); the UI never loads all students.
* **Indexes** for every filter/search path; unique indexes also guarantee *one seat per student* and *one student per seat* at the database level.
* Imports and allocations use **chunked bulk writes** (1,000 per batch). Seat records carry a denormalised snapshot, so listing/filtering needs **no joins**.
* The allocator is a pure O(S log S) function: **5,000 students seated in ~50 ms** (measured; see `npm run test:allocator`).
* CSV export is **streamed** with a DB cursor (constant memory). Responses are gzip-compressed. Mongo connection pool of 50.

## Deploying

1. `cd client && npm run build` — the API then serves `client/dist` itself (same origin → safest cookies).
2. Set `NODE_ENV=production`, a strong `JWT_SECRET`, MongoDB with authentication (or Atlas), and serve over **HTTPS** (nginx/Caddy; `trust proxy` is already enabled).
3. Run with PM2 (`pm2 start src/server.js -i max`) for multiple CPU cores. Schedule MongoDB backups.
4. Change the seeded super-admin password right after first login.

## Not included yet (good next steps)

Email verification / "forgot password" by email (needs SMTP — today an admin uses *Reset login*), PDF admit cards
(browser *Print seat slip* is available), invigilator assignment, notices/announcements, two-factor auth for admins.
