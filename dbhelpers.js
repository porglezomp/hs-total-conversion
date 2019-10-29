const sqlite3 = require("sqlite3").verbose();

const dbFile = "./.data/sqlite.db";
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`
PRAGMA recursive_triggers=0;

CREATE TABLE IF NOT EXISTS Images
( for_url TEXT NOT NULL
, filename TEXT NOT NULL
, on_page TEXT NOT NULL
, blocked BOOLEAN NOT NULL DEFAULT FALSE
, accepted BOOLEAN NOT NULL DEFAULT FALSE
, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, contact TEXT NOT NULL DEFAULT ''
, credits TEXT NOT NULL DEFAULT ''
, CONSTRAINT not_both CHECK (NOT (blocked AND accepted))
, UNIQUE (for_url, filename)
);

CREATE TRIGGER do_update_at UPDATE ON Images
BEGIN
    UPDATE Images
    SET updated_at = CURRENT_TIMESTAMP WHERE for_url = OLD.for_url AND filename = OLD.filename;
END;

CREATE UNIQUE INDEX IF NOT EXISTS unique_accepted
    ON Images (for_url)
    WHERE accepted;
`);
});

function all(query, ...binds) {
    return new Promise((resolve, reject) => {
      db.all(query, ...binds, (err, rows) => {
        if (err) {
          reject(err);
        }
        resolve(rows);
      });
    });
  }

function get(query, ...binds) {
  return new Promise((resolve, reject) => {
    db.get(query, ...binds, (err, row) => {
      if (err) {
        reject(err);
      }
      resolve(row);
    });
  });
}

function run(query, ...binds) {
  return new Promise((resolve, reject) => {
    db.run(query, ...binds, err => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

exports.all = all;
exports.get = get;
exports.run = run;