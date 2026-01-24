const fs = require("fs");
const path = require("path");
const USERS_PATH = path.join(__dirname, "../data/users.json");

module.exports = {
  loadUsers: () => {
    if (!fs.existsSync(USERS_PATH)) return {};
    return JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
  },
  saveUsers: (users) => {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  },
};
