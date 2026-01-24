// const fs = require("fs");
// const path = require("path");
// const USERS_PATH = path.join(__dirname, "../data/users.json");

// module.exports = {
//   loadUsers: () => {
//     if (!fs.existsSync(USERS_PATH)) return {};
//     return JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
//   },
//   saveUsers: (users) => {
//     fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
//   },
// };

const fs = require("fs");
const path = require("path");

// This logic automatically switches between your local PC and Railway's Volume
const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "users.json")
  : path.join(__dirname, "../users.json");

function loadUsers() {
  // If the file doesn't exist yet (first time running), create an empty object
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH));
}

function saveUsers(users) {
  fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
}

module.exports = { loadUsers, saveUsers };
