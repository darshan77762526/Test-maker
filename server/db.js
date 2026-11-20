const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const firebaseStore = require('./firebase');

const isVercel = !!process.env.VERCEL;
const dataDir = process.env.DATA_DIR || (isVercel ? '/tmp/data' : path.join(__dirname, '..', 'data'));
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
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
      hide_results_student INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      window_start DATETIME,
      window_end DATETIME,
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
      proctoring_photos TEXT,
      device_info TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS deleted_tests (
      test_code TEXT PRIMARY KEY,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_submissions_user_test ON submissions(user_id, test_id);
  `;

  await query.exec(schema);

  // Safe table migrations for existing databases
  await query.exec(`ALTER TABLE tests ADD COLUMN window_start DATETIME`).catch(() => {});
  await query.exec(`ALTER TABLE tests ADD COLUMN window_end DATETIME`).catch(() => {});
  await query.exec(`ALTER TABLE submissions ADD COLUMN proctoring_photos TEXT`).catch(() => {});

  // Seed administrator if configured in environment
  const adminEmail = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.toLowerCase().trim() : null;
  const rawPass = process.env.ADMIN_PASSWORD;

  if (adminEmail && rawPass) {
    const existingAdmin = await query.get('SELECT * FROM users WHERE email = ?', [adminEmail]);
    if (!existingAdmin) {
      const passHash = await bcrypt.hash(rawPass, 10);
      const adminName = process.env.ADMIN_NAME || 'Exam Administrator';
      await query.run(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [adminName, adminEmail, passHash, 'ADMIN']
      );
      console.log(`[DB] Created administrator account from environment: ${adminEmail}`);
    }
  }

  // Pre-seed sample test ONCE if available and never deleted by admin
  const isDeleted = await query.get('SELECT * FROM deleted_tests WHERE test_code = ?', ['JEE2026S1']);
  const isFbDeleted = await firebaseStore.isTestDeleted('JEE2026S1');
  if (isDeleted || isFbDeleted) {
    return;
  }

  const sampleFileName = 'sample_jee_main_2026.html';
  const bundledSample = path.join(__dirname, 'uploads', sampleFileName);
  const targetUploadDir = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads'));

  if (!fs.existsSync(targetUploadDir)) {
    try { fs.mkdirSync(targetUploadDir, { recursive: true }); } catch (e) {}
  }

  const targetSample = path.join(targetUploadDir, sampleFileName);
  if (!fs.existsSync(targetSample) && fs.existsSync(bundledSample)) {
    try { fs.copyFileSync(bundledSample, targetSample); } catch (e) {}
  }

  if (fs.existsSync(targetSample)) {
    const existingTest = await query.get('SELECT * FROM tests WHERE test_code = ? OR file_name = ?', ['JEE2026S1', sampleFileName]);
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
          0
        ]
      );
      console.log(`[DB] Pre-seeded sample test: JEE (Main) 2026 Shift 1`);
    }

    // Ensure Firebase Cloud copy exists
    if (firebaseStore.isAvailable()) {
      try {
        const fbExisting = await firebaseStore.getTest('JEE2026S1');
        if (!fbExisting) {
          const sampleContent = fs.readFileSync(targetSample, 'utf8');
          await firebaseStore.saveTest({
            id: 1,
            test_code: 'JEE2026S1',
            title: 'JEE (Main) 2026 Shift 1 Official CBT',
            description: 'Full length mock paper: Physics, Chemistry, Mathematics (25 Qs each, +4 / -1)',
            file_name: sampleFileName,
            duration_minutes: 180,
            total_questions: 75,
            subjects: ['Physics', 'Chemistry', 'Mathematics'],
            hide_results_student: 0,
            is_active: 1,
            created_at: new Date().toISOString(),
            html_content: sampleContent
          });
          console.log(`[Firebase] Initialized JEE2026S1 in Cloud RTDB`);
        }
      } catch (e) {}
    }
  }
}

module.exports = {
  db,
  query,
  initDatabase
};
