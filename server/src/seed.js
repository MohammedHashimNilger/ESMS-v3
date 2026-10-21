require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./models/Admin');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const existing = await Admin.findOne({ role: 'superadmin' });
  if (existing) { console.log(`Super admin already exists: ${existing.email}`); return process.exit(0); }
  const { SEED_ADMIN_NAME: name = 'Super Admin', SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } = process.env;
  if (!email || !password || password.length < 8) { console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 8 chars) in .env'); process.exit(1); }
  await Admin.create({ name, email, password, role: 'superadmin' });
  console.log(`Super admin created: ${email}\nLog in at /admin/login and change these credentials from Settings.`);
  process.exit(0);
})();
