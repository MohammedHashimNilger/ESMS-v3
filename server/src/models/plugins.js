const bcrypt = require('bcryptjs');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Shared password hashing + brute-force lockout for Admin and Student. */
module.exports = function authPlugin(schema) {
  schema.add({
    failedAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    passwordChangedAt: Date,
  });

  schema.pre('save', async function () {
    if (!this.isModified('password') || !this.password) return;
    this.password = await bcrypt.hash(this.password, 12);
    if (!this.isNew) this.passwordChangedAt = new Date(); // invalidates older JWTs
  });

  schema.methods.comparePassword = function (plain) {
    return this.password ? bcrypt.compare(plain, this.password) : Promise.resolve(false);
  };
  schema.methods.isLocked = function () {
    return !!(this.lockUntil && this.lockUntil.getTime() > Date.now());
  };
  schema.methods.registerFailure = async function () {
    if (this.lockUntil && this.lockUntil.getTime() <= Date.now()) {
      this.failedAttempts = 0;
      this.lockUntil = undefined;
    }
    this.failedAttempts += 1;
    if (this.failedAttempts >= MAX_ATTEMPTS) {
      this.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      this.failedAttempts = 0;
    }
    await this.save({ validateBeforeSave: false });
  };
  schema.methods.resetFailures = async function () {
    if (this.failedAttempts || this.lockUntil) {
      this.failedAttempts = 0;
      this.lockUntil = undefined;
      await this.save({ validateBeforeSave: false });
    }
  };

  schema.set('toJSON', {
    transform: (_doc, ret) => {
      delete ret.password; delete ret.failedAttempts; delete ret.lockUntil;
      delete ret.passwordChangedAt; delete ret.__v;
      return ret;
    },
  });
};
