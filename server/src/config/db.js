const mongoose = require('mongoose');

module.exports = async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
    autoIndex: process.env.NODE_ENV !== 'production',
  });
  console.log('MongoDB connected');
};
