# ESMS v3 - Exam Seating Management System

A full-stack web application for managing university exam seating with automated room allocation and student seat lookup.

Live demo: https://esms-v3-alpha.vercel.app/

## Overview

ESMS v3 helps exam cells generate seating plans quickly and accurately for large student cohorts. The admin panel lets staff upload student data, define rooms, schedule exams, and allocate seats automatically. Students can log in to view their own seat details, room, floor, and printable slip.

This project is well suited for a resume because it combines:
- React frontend with protected admin/student flows
- Express + MongoDB backend
- Real-world workflow automation for exam management
- Security-focused authentication and role-based access
- Large-scale seating algorithm and data handling

## Tech Stack

- Frontend: React, Vite, React Router
- Backend: Node.js, Express
- Database: MongoDB with Mongoose
- Auth: JWT cookies + bcrypt password hashing
- Data import: CSV / Excel support via SheetJS

## Key Features

### Admin
- Dashboard overview
- Student management with bulk import
- Room and seat configuration
- Exam creation and scheduling
- Automated seating allocation
- Seating plan review and export
- Admin user management and audit log
- Settings and shift configuration

### Student
- Sign up and login
- View upcoming/current/past exams
- See seat, room, building, and floor
- Printable seat ticket
- Room map with assigned seat highlighted

## Project Structure

```bash
ESMS-v3/
├── client/     # React frontend
├── server/     # Express backend
├── Readme.md   # Project documentation
├── .gitignore
└── package.json (if added at root later)
```

## Live Demo

https://esms-v3-alpha.vercel.app/

## Local Setup

### Prerequisites
- Node.js 18+
- MongoDB

### Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### Configure environment

Create `server/.env`:

```env
MONGO_URI=mongodb://localhost:27017/esms
JWT_SECRET=replace-with-a-random-string-of-at-least-32-characters
CLIENT_ORIGIN=http://localhost:5173
PORT=5000
SEED_ADMIN_NAME=Super Admin
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=ChangeMe123
```

### Run the app

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Open http://localhost:5173

## Resume Summary

`ESMS v3` is a full-stack exam seating management system built with React, Node.js, Express, and MongoDB. It automates exam room allocation, supports bulk student imports, handles role-based access for students and administrators, and includes a printable seat ticket system. The project demonstrates practical experience in workflow automation, data handling, authentication, and full-stack application development.

## Author

Mohammed Hashim Nilger
GitHub: https://github.com/MohammedHashimNilger
