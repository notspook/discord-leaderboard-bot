const db = require("./database");

db.run(`ALTER TABLE users ADD COLUMN dailyMessages INTEGER DEFAULT 0`);
db.run(`ALTER TABLE users ADD COLUMN dailyVoice INTEGER DEFAULT 0`);

console.log("DB updated");