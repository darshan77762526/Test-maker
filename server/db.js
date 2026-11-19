const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'cbt.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
  } else {
    console.log(`[DB] Connected to SQLite database at ${dbPath}`);
  }
});

// Promisified helpers
const query = {
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },
  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },
  exec: (sql) => {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};

async function initDatabase() {
  // Schema creation
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'STUDENT',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      device_os TEXT,
      device_browser TEXT,
      device_type TEXT,
      screen_size TEXT,
      ip_address TEXT,
      user_agent TEXT,
      login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_ping_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      terminated_reason TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      file_name TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 180,
      total_questions INTEGER DEFAULT 0,
      subjects TEXT DEFAULT '[]',
      hide_results_student INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      test_id INTEGER NOT NULL,
      session_id INTEGER,
      total_score REAL DEFAULT 0,
      max_marks REAL DEFAULT 300,
      correct_count INTEGER DEFAULT 0,
      incorrect_count INTEGER DEFAULT 0,
      unattempted_count INTEGER DEFAULT 0,
      accuracy_percent REAL DEFAULT 0,
      time_taken_sec INTEGER DEFAULT 0,
      answers_json TEXT,
      device_info TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_submissions_user_test ON submissions(user_id, test_id);
  `;

  await query.exec(schema);

  // Seed default admin if not existing
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@cbtportal.com').toLowerCase().trim();
  const existingAdmin = await query.get('SELECT * FROM users WHERE email = ?', [adminEmail]);

  if (!existingAdmin) {
    const rawPass = process.env.ADMIN_PASSWORD || 'Admin@123';
    const passHash = await bcrypt.hash(rawPass, 10);
    const adminName = process.env.ADMIN_NAME || 'Exam Administrator';
    await query.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [adminName, adminEmail, passHash, 'ADMIN']
    );
    console.log(`[DB] Created default administrator: ${adminEmail} (password: ${rawPass})`);
  }

  // Pre-seed sample test if available
  const sampleFileName = 'sample_jee_main_2026.html';
  const samplePath = path.join(__dirname, 'uploads', sampleFileName);
  if (fs.existsSync(samplePath)) {
    const existingTest = await query.get('SELECT * FROM tests WHERE file_name = ?', [sampleFileName]);
    if (!existingTest) {
      await query.run(
        `INSERT INTO tests 
        (test_code, title, description, file_name, duration_minutes, total_questions, subjects, hide_results_student)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'JEE2026S1',
          'JEE (Main) 2026 Shift 1 Official CBT',
          'Full length mock paper: Physics, Chemistry, Mathematics (25 Qs each, +4 / -1)',
          sampleFileName,
          180,
          75,
          JSON.stringify(['Physics', 'Chemistry', 'Mathematics']),
          1 // Results visible to Admin only by default as requested
        ]
      );
      console.log(`[DB] Pre-seeded sample test: JEE (Main) 2026 Shift 1`);
    }
  }
}

module.exports = {
  db,
  query,
  initDatabase
};
