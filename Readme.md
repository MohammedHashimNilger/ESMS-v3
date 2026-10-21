
# ESMS v3: Exam Seating Management System

A full-stack web app that lets a university exam cell generate seating plans for thousands of students in one click, and lets each student look up their own seat, room and floor.

Built with the MERN stack (MongoDB, Express, React, Node.js).

## Why this exists

Seating plans for a big exam are usually done by hand in spreadsheets. It's slow, error-prone, and students end up crowding around notice boards. ESMS automates the whole flow:

1. The exam cell uploads the master student list and defines rooms and exam schedules.
2. The allocator seats every student for a given date and shift.
3. Students log in and see exactly where to sit, and can print a seat slip.

## Features

### Admin panel
- **Dashboard** with an overview of students, rooms, exams and allocations
- **Student management**: add, edit, delete, search and filter; bulk import from CSV / Excel (up to 20,000 rows per file, template included); mark students as `active` or `debarred`; reset a student's account so they can sign up again
- **Room management**: define rooms by building, floor, rows and columns; disable broken or reserved seats; deactivate rooms
- **Exam scheduling**: create exams per course, year and (optionally) semester, with a date, shift and subject for each paper; a paper can target one branch or all branches
- **Seat allocation**: preview a dry run first (eligible, seated, rooms needed), then save; allocate one slot or all pending slots at once; clear a slot
- **Seating viewer**: browse the full seat grid of any room for any slot, filter and search allocations, move a student to another empty seat, or remove a student from a seat
- **CSV export** of the seating plan (streamed, so memory stays flat even for large exports)
- **Admins & audit log** (super admin only): create admins, reset admin passwords, view the audit trail of who did what
- **Settings**: change your own name, email and password; configure shift timings (Morning / Afternoon / Evening)

### Student portal
- Sign-up is restricted to students already in the admin-uploaded master list (name and MUR number must match university records)
- Dashboard with the student's details and every upcoming, current and past paper
- Seat ticket showing subject, date, shift and timing, room, building, floor, row/column and seat number
- Room seat map with the student's seat highlighted (other students' seats are shown as occupied, with no names exposed)
- Printable seat slip

## The allocation algorithm

The allocator (`server/src/utils/allocator.js`) is a pure function with no database access, so it's fast and unit-testable.

- A **group** is one class: course + branch + year + semester.
- Groups are sorted naturally and rooms are consumed in order (by building, floor, then name), so a class tends to sit in neighbouring rooms.
- Every room holds **at most two groups**: group A fills the odd columns (1, 3, 5, ...) and group B fills the even columns (2, 4, 6, ...). Students from the same class are never seated side by side.
- If only one group is left, the even columns stay empty.
- Seat numbers run **down each column**.
- Disabled seats are skipped.
- If a student appears in more than one exam for the same slot, they're seated once.
- If there aren't enough seats, the run is rejected with a clear error and nothing is saved.

Complexity is `O(S log S + R × seatsPerRoom)`. The test script seats 5,000 students across 70 rooms.

## Tech stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18, React Router 6, Axios, Vite 5 |
| Backend | Node.js, Express 4 |
| Database | MongoDB with Mongoose 8 |
| Auth | JWT in an httpOnly cookie, bcryptjs password hashing |
| Import | Multer + SheetJS (`xlsx`) |
| Hardening | Helmet (CSP), express-rate-limit, CORS, input sanitising |

## Security

- JWT stored in an **httpOnly, SameSite=Lax** cookie (`secure` in production), so JavaScript can't read it
- Passwords hashed with bcrypt; password rules enforced on the server (8-72 chars, at least one letter and one number)
- **Account lockout** for 15 minutes after repeated failed logins, plus a rate limit on auth endpoints (30 attempts per 15 minutes) and a global API limit (600 requests per minute)
- Sessions are invalidated when a password is changed
- Role-based access: `student`, `admin`, `superadmin`
- Request sanitiser strips Mongo operators and dotted keys to block NoSQL injection
- CSV export escapes values to prevent formula injection
- Students only ever receive their own seat data; other occupied seats are sent as bare seat numbers
- Strict Content Security Policy via Helmet
- Admin actions are written to an audit log (kept for one year)

## Project structure

```
ESMS-v3/
├── client/                     # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx             # Routes and role guards
│   │   ├── api.js              # Axios instance
│   │   ├── auth.jsx            # Auth context
│   │   ├── components/         # AdminLayout, RoomGrid, shared UI
│   │   └── pages/
│   │       ├── AdminLogin.jsx
│   │       ├── StudentAuth.jsx
│   │       ├── admin/          # Dashboard, Students, Rooms, Exams,
│   │       │                   # Allocation, Seating, Admins, Settings
│   │       └── student/        # StudentHome
│   └── vite.config.js          # Dev server + /api proxy
└── server/                     # Express API
    └── src/
        ├── server.js           # Entry point (env checks, DB, index sync)
        ├── app.js              # Middleware and route wiring
        ├── config/db.js
        ├── middleware/         # auth, error handler, sanitiser
        ├── models/             # Admin, Student, Room, Exam,
        │                       # Allocation, AuditLog, Setting
        ├── routes/             # auth, me, students, rooms, exams,
        │                       # allocations, dashboard, admins, settings
        ├── utils/              # allocator (+ test), helpers
        ├── seed.js             # Creates the super admin
        └── seedDemo.js         # Demo data at realistic scale
```

## Getting started

### Prerequisites
- Node.js 18+
- A MongoDB database (local, or a free MongoDB Atlas cluster)

### 1. Clone and install

```bash
git clone https://github.com/MohammedHashimNilger/ESMS-v3.git
cd ESMS-v3

cd server && npm install
cd ../client && npm install
```

### 2. Configure the server

Create `server/.env`:

```env
MONGO_URI=mongodb://localhost:27017/esms
JWT_SECRET=replace-with-a-random-string-of-at-least-32-characters
CLIENT_ORIGIN=http://localhost:5173
PORT=5000

# Used once by `npm run seed` to create the first super admin
SEED_ADMIN_NAME=Super Admin
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=ChangeMe123
```

| Variable | Required | Notes |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | At least 32 characters, or the server refuses to start |
| `CLIENT_ORIGIN` | No | Allowed CORS origin. Defaults to `http://localhost:5173` |
| `PORT` | No | Defaults to `5000` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | For seeding | Password must be at least 8 characters |
| `SEED_ADMIN_NAME` | No | Defaults to `Super Admin` |

### 3. Create the super admin

```bash
cd server
npm run seed
```

You can change these credentials later from **Settings** in the admin panel.

### 4. (Optional) Load demo data

```bash
npm run seed:demo
```

This creates 4,800 students, 60 rooms (80 seats each) and a sample B.Tech Year 1 mid-term, so you can test at realistic scale. To try the student side, sign up with `MUR000001` and the name printed in the terminal.

### 5. Run in development

In two terminals:

```bash
# Terminal 1: API on :5000
cd server && npm run dev

# Terminal 2: React app on :5173 (proxies /api to :5000)
cd client && npm run dev
```

Open http://localhost:5173.

- Students: `/login` and `/signup`
- Admins: `/admin/login`

### 6. Production build

```bash
cd client && npm run build
cd ../server && NODE_ENV=production npm start
```

When `client/dist` exists, the Express server serves the built React app from the same origin, which keeps cookies simple and safe. In production, Mongoose `autoIndex` is off and indexes are synced on startup instead.

## Typical workflow

1. Log in as admin and import students from CSV / Excel (use **Download template** on the Students page).
2. Add rooms under **Rooms**. Mark any broken seats as disabled.
3. Create an exam under **Exams** and add papers with date, shift and subject.
4. Go to **Allocation**, preview a slot, then confirm. Or use allocate-all for every pending slot.
5. Inspect room layouts under **Seating**, and export the plan to CSV if needed.
6. Students sign up or log in, see their seat, and print their slip.

## Student import format

Columns (header names are matched flexibly, e.g. `MUR`, `Roll No`, `Dept` and `Sem` all work):

`Name, Enrollment No (MUR), Email (optional), Course, Branch, Year, Semester`

- Existing MURs are updated, new ones are added
- Year and semester accept numbers or words like "first" and "second"
- Max file size 5 MB, max 20,000 rows, formats `.csv`, `.xlsx`, `.xls`

## API overview

All routes live under `/api`.

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Health check |
| `/auth/*` | Public / role-based | Student signup and login, admin login, logout, profile and password updates |
| `/me/overview` | Student | The student's own seats |
| `/students/*` | Admin | CRUD, filters, bulk import, template, account reset |
| `/rooms/*` | Admin | Room CRUD |
| `/exams/*` | Admin | Exam CRUD and summaries |
| `/allocations/*` | Admin | Run / clear allocation, slots, list, export, room grids, move and remove seats |
| `/dashboard` | Admin | Overview stats |
| `/admins/*` | Super admin | Admin management and audit log |
| `/settings/shifts` | Any user (read), admin (write) | Shift timings |

## Tests

The allocator has a standalone test that seats 5,000 students across 70 rooms and asserts that nobody is double-booked, no disabled seat is used, each room holds at most two groups, and odd/even columns each hold a single group.

```bash
cd server
npm run test:allocator
```

## Roadmap ideas

- Invigilator assignment per room
- Admit-card PDF generation
- Email or SMS notification when a seating plan is published
- Per-room printable attendance sheets

## Author

**Mohammed Hashim Nilger**
GitHub: [@MohammedHashimNilger](https://github.com/MohammedHashimNilger)
