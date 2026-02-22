const Trigger = require("../models/Trigger");

let triggerCache = [];

async function updateTriggerCache() {
  try {
    triggerCache = await Trigger.find();
    console.log(
      `🔄 Trigger Cache Updated: ${triggerCache.length} keywords loaded.`,
    );
  } catch (err) {
    console.error("❌ Cache Update Error:", err);
  }
}

function getTriggerCache() {
  return triggerCache;
}

module.exports = { updateTriggerCache, getTriggerCache };
