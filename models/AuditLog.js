const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema({
  modId: String, // The Admin who ran the command
  modTag: String, // Their name for easy reading
  targetId: String, // The player affected
  action: String, // "ADD" or "REMOVE"
  amount: Number, // How much gold
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AuditLog", AuditLogSchema);
