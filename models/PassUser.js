const mongoose = require("mongoose");

const passUserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  passBalance: { type: Number, default: 1000000 }, // Start with 1M VIP Gold
  totalWagered: { type: Number, default: 0 },
  totalWon: { type: Number, default: 0 },
  totalLost: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  lastDaily: { type: Date, default: null },
});

module.exports = mongoose.model("PassUser", passUserSchema);
