const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, // Discord ID
  ttio: { type: String, default: null }, // Game ID
  gold: { type: Number, default: 0 }, // Gold Balance
  verified: { type: Boolean, default: false }, // Status
  lastDaily: { type: Date, default: null }, // Cooldowns

  // Added these to support the tracker and registration logic
  latest_tx_time: { type: Number, default: 0 }, // Last transaction timestamp from game logs
  registeredAt: { type: Date, default: Date.now }, // When they first linked their account
});

module.exports = mongoose.model("User", UserSchema);
