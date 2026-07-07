const isPG = !!process.env.DATABASE_URL;

let db;

if (isPG) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  function q(sql, params = []) {
    let idx = 0;
    let pgSql = sql
      .replace(/\?/g, () => `$${++idx}`)
      .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "SERIAL PRIMARY KEY")
      .replace(/AUTOINCREMENT/gi, "")
      .replace(/\blastjoin\s+INTEGER\b/gi, "lastjoin BIGINT")
      .replace(/\bbannedat\s+INTEGER\b/gi, "bannedat BIGINT");

    // INSERT OR IGNORE -> ON CONFLICT DO NOTHING
    pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
    const isIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);

    // INSERT OR REPLACE -> ON CONFLICT (pk) DO UPDATE SET all non-pk cols = EXCLUDED.col
    pgSql = pgSql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, "INSERT INTO");
    const isReplace = /INSERT\s+OR\s+REPLACE/i.test(sql);

    if (isIgnore || isReplace) {
      // Extract table name and columns to build ON CONFLICT clause
      const tblMatch = sql.match(/INTO\s+(\w+)\s*\(([^)]+)\)/i);
      if (tblMatch) {
        const table = tblMatch[1];
        const cols = tblMatch[2].split(",").map(c => c.trim());
        if (isIgnore) {
          // Simple: ON CONFLICT DO NOTHING works for any constraint
          pgSql += " ON CONFLICT DO NOTHING";
        } else {
          // Find the PK column (first col that looks like a key)
          const pkCol = cols[0];
          const updateCols = cols.filter(c => c !== pkCol);
          if (updateCols.length > 0) {
            const setClause = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(", ");
            pgSql += ` ON CONFLICT (${pkCol}) DO UPDATE SET ${setClause}`;
          } else {
            pgSql += " ON CONFLICT (${pkCol}) DO NOTHING";
          }
        }
      }
    }

    return { sql: pgSql, params };
  }

  // Map PG's lowercase column names back to camelCase (SQLite preserves case, PG doesn't)
  const CASE_MAP = {
    userid: "userId", messages: "messages", voiceseconds: "voiceSeconds",
    lastjoin: "lastJoin", dailymessages: "dailyMessages", dailyvoice: "dailyVoice",
    larpstreak: "larpStreak", larpwins: "larpWins", channelid: "channelId",
    roleid: "roleId", sharedwith: "sharedWith", bannedat: "bannedAt",
    timestamp: "timestamp", username: "username"
  };
  function fixRow(row) {
    if (!row) return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = v;
      const mapped = CASE_MAP[k];
      if (mapped && mapped !== k) out[mapped] = v;
    }
    return out;
  }

  function call(method, sql, params, cb) {
    if (typeof params === "function") { cb = params; params = []; }
    const { sql: pgSql, params: pgParams } = q(sql, params || []);
    pool.query(pgSql, pgParams).then(r => {
      if (!cb) return;
      if (method === "run") cb(null, r);
      else if (method === "get") cb(null, fixRow(r.rows[0]));
      else cb(null, r.rows.map(fixRow));
    }).catch(e => {
      if (cb) cb(e);
    });
  }

  db = {
    run(sql, params, cb) { call("run", sql, params, cb); },
    get(sql, params, cb) { call("get", sql, params, cb); },
    all(sql, params, cb) { call("all", sql, params, cb); },
    serialize(fn) { fn(); }
  };
} else {
  const sqlite3 = require("sqlite3").verbose();
  const sdb = new sqlite3.Database("./data.db");
  db = {
    run(sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      sdb.run(sql, params || [], cb);
    },
    get(sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      sdb.get(sql, params || [], cb);
    },
    all(sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      sdb.all(sql, params || [], cb);
    },
    serialize(fn) { sdb.serialize(fn); }
  };
}

module.exports = db;
