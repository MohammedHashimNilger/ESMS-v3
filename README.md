# ESMS v3 - Exam Seating Management System

A full-stack exam management platform designed to automate university seating allocation, reduce manual errors, and help students quickly find their assigned exam seat.

Live demo: https://esms-v3-alpha.vercel.app/

## Overview

ESMS v3 solves a common university problem: manually creating seating arrangements for large batches of students is slow, error-prone, and difficult to manage at scale. This application allows exam administrators to upload student data, define rooms, create exams, and generate seating plans automatically.

Students can sign in to view their own seat, room number, building, floor, and printable exam slip without exposing other students' seat information.

This project is a strong portfolio candidate because it combines real-world workflow automation with modern full-stack development practices, security, and scalable logic.

## Why this project stands out

- Full-stack web app with role-based access for admin and student users
- Real-world business workflow for university exam management
- Automated seat allocation logic for large datasets
- Bulk import support for student records using CSV / Excel files
- Security-focused authentication and protected routes
- Production-ready frontend/backend structure with separate client and server apps

## Tech Stack

- Frontend: React, Vite, React Router
- Backend: Node.js, Express
- Database: MongoDB with Mongoose
- Authentication: JWT in cookies, bcrypt password hashing
- File Import: SheetJS (CSV / Excel parsing)
- Deployment: Vercel frontend, Node.js backend hosting

## Key Features

### Admin Features
- Dashboard with key overview metrics
- Student management and bulk import
- Room management with seat configuration
- Exam scheduling and paper creation
- Automated seat allocation for exam slots
- Seating plan review and room-wise seat mapping
- CSV export for exam plans
- Admin management and audit trail
- Settings for user profile and time slots

### Student Features
- Secure sign-up and login
- Student dashboard with upcoming/current/past exams
- View assigned room, floor, row, and seat number
- Printable seat ticket/slip
- Room seating map with the student's seat highlighted

## Project Structure

```bash
ESMS-v3/
├── client/                 # React frontend (Vite)
│   ├── src/               # App pages, components, auth, and styles
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── server/                 # Express backend API
│   ├── src/               # Routes, models, middleware, utils
│   ├── package.json
│   └── .env
├── README.md              # Project documentation
├── .gitignore
└── LICENSE (if added later)
```

## Live Demo

https://esms-v3-alpha.vercel.app/

## Local Setup

### Prerequisites

- Node.js 18+
- MongoDB instance

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

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

### 3. Create the initial admin

```bash
cd server
npm run seed
```

### 4. Run the app

In two terminals:

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Open: http://localhost:5173

## Resume Summary

`ESMS v3` is a full-stack exam seating management system built with React, Node.js, Express, and MongoDB. It automates exam room allocation, supports bulk student import, secures admin/student access with authentication, and provides a user-friendly seat lookup experience for university exam workflows.

## Author

Mohammed Hashim Nilger
GitHub: https://github.com/MohammedHashimNilger
