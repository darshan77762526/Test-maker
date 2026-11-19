const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');

const defaultServiceAccount = {
  "type": "service_account",
  "project_id": "cbt-checker",
  "private_key_id": "895a2d0fa3dd5493a1734b08f3ffdd8f63c63413",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCrCnDse/bAyeDz\nVATgCThBrD1R7gITEC/vIznu8MxJu6qQBHxPgJU4EXc/P2oIWqzl51yet6SF0fb2\nFJZUCp0ESJa1qR7AfidvhJAMdTE4pMXTjuIy0U+ks1FsbfaGQ7ugTqSLBZH3nThK\nmBcbwmSu4i4wmGrgCOtxYAunygahXRlELSwP8oAWf95DvDEoV/D7AoheHU1kmSAT\nFLCJtHLDnG4fCKo50xycnptTMFThc8Q79mzY8ZCot2U4b3Q7SU+FDEtZX4wrpXc9\nNfq/d262UBE5wBRE35PWmTn3EU8phLFtlSZ6dDx6LGYVULCpCzhe4q8E0jc3Jvvy\neiE0f677AgMBAAECggEAIpk9GIlG896ic3ZWeh9DUv2NdepIXyTSHXSpvmzVVkDx\nEqrlnotrI+lcjt28DC6TdPolITISxMMhSswFUMDI3Fn2qo6oWtXqEkPlg6+dIlEq\nd04a8Z6nlrBzUxS3XpeK97WQ0VJyIX2bKnOzkPj0tu+n2kqqq+ECB3AfS3SxfKhs\nsYH0bGmrYcykn3DtLSBVdAwcCSIMlKAjAxSZo8YL24kcK7SaKRKPuUnQ9Tr5C93S\nAqTCboTuwIJkBr9riDjSYTwtMRUVSN1Smf3Al9ll8R6grTlgIWHunraz7Q0f6nws\nNWfdiSB8jdFNLoE7XA8EMRmZTpVGXvm4sYF/iyskGQKBgQDcyEE17GyXUPtDFUr+\nWpy+gn8oAlLUkCvyxmR32oJ8uqtrAuGFvoAouxu65UTaYa8iIrg9LFXvuB/+1O1q\nEBbs+EKbqYHuGWzr2WV7jP6rLeEhjeHKhnaiip0Ear36n02k/+r9EmnZ6tPC9b+r\nHnVXV2fuMJPS2OKYAR48XlyQtQKBgQDGUviIsuIBWEcYCrUBVDgp8ouGGyM1oqY6\nMd+da5hQaph1qeqCjLpsK1M2pmyBm8Vej4ZFZKtIx1JufxgYvF3hSLUXzfI76qlA\nTe3CqBeso9LzEqhJ9fwH74UgwWPSc8ZC80DwjmkDS4y3wC8F8PZ3L5J/Uvyo6nXB\nK3XxYB3+7wKBgQDK21TPbwP3pHi5En9tZWRPxyd+Y2Qn2rAGyTLWzPbIE9wc3vDI\nKlknE4RPHQk+fjKkcrJFws7TC6KaSpo5sb7ezNymmgC//KyPp5gPBWWZcvZAFlU3\n+IRYpHPQ8yLLfEOjL2GCVcDccV9Q6uvJFptKPQ1JVWj9ejn44E4fubPjYQKBgGXC\njum9N3/PJvNsEwHyj7reS77sz70mjrpPetiQK6Afgcjl/YEs6j60YEcrT4OVRMlH\nRXL3u3dlZqNxrRCMHnOI1fq33nHl7yAinDuD+lnH2WaFjTod8Eq2GI39DNYgN3uE\nyy5jM/jP3A0wnDAlOqFfFIEmOKQHYZJTVXobgmibAoGBANHoL8JD0u7x0Wx/RfSt\nHw9R3PcSD+KrODlJS/LW0F9ARd2To5tH1QxD6RwfLss8qNnyfl+bHDOI6QcCVpRg\nKsCw4qspBtdN2yksQdX+P78j7PAvUA82Y3JSOSJbSFJNXEBscPoWg7j42N5gh9LF\nu+BC3fEIHXRbCZMxDHLh9/9O\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@cbt-checker.iam.gserviceaccount.com"
};

let db = null;
let isInitialized = false;

function initFirebase() {
  if (isInitialized && db) return db;

  try {
    let serviceAccount = defaultServiceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (e) {}
    }

    if (!admin.apps.length) {
      const app = admin.initializeApp({
        credential: admin.cert(serviceAccount),
        databaseURL: "https://cbt-checker-default-rtdb.asia-southeast1.firebasedatabase.app"
      });
      db = getDatabase(app);
    } else {
      db = getDatabase(admin.apps[0]);
    }

    isInitialized = true;
    console.log('[Firebase] Successfully connected to Realtime Database for project: cbt-checker');
    return db;
  } catch (err) {
    console.error('[Firebase] Init error:', err.message);
    return null;
  }
}

// Helper to escape keys for Realtime Database (no '.', '$', '#', '[', ']')
function safeKey(str) {
  return String(str || '').toLowerCase().replace(/[\.#\$\[\]\/]/g, '_');
}

const firebaseStore = {
  isAvailable: () => true,

  getDb: () => initFirebase(),

  // Users
  async saveUser(user) {
    const rtdb = initFirebase();
    if (!rtdb || !user.email) return;
    const key = safeKey(user.email);
    await rtdb.ref(`cbt/users/${key}`).set({
      ...user,
      updatedAt: new Date().toISOString()
    });
  },

  async getUser(email) {
    const rtdb = initFirebase();
    if (!rtdb || !email) return null;
    const key = safeKey(email);
    const snap = await rtdb.ref(`cbt/users/${key}`).once('value');
    return snap.val();
  },

  async getUsersCount() {
    const rtdb = initFirebase();
    if (!rtdb) return 0;
    try {
      const snap = await rtdb.ref('cbt/users').once('value');
      const val = snap.val();
      return val ? Object.keys(val).length : 0;
    } catch (e) {
      return 0;
    }
  },

  // Sessions
  async saveSession(session) {
    const rtdb = initFirebase();
    if (!rtdb) return;
    const key = String(session.id || safeKey(session.token));
    await rtdb.ref(`cbt/sessions/${key}`).set({
      ...session,
      updatedAt: new Date().toISOString()
    });
  },

  async getSessions() {
    const rtdb = initFirebase();
    if (!rtdb) return [];
    try {
      const snap = await rtdb.ref('cbt/sessions').limitToLast(100).once('value');
      const val = snap.val();
      if (!val) return [];
      return Object.values(val).sort((a, b) => new Date(b.last_ping_at || b.login_at || 0) - new Date(a.last_ping_at || a.login_at || 0));
    } catch (e) {
      console.error('[Firebase] getSessions error:', e.message);
      return [];
    }
  },

  async terminateOldSessions(userId, currentToken) {
    const rtdb = initFirebase();
    if (!rtdb) return;
    try {
      const snap = await rtdb.ref('cbt/sessions').once('value');
      const val = snap.val();
      if (!val) return;
      const updates = {};
      Object.entries(val).forEach(([key, s]) => {
        if (s.user_id === userId && s.token !== currentToken && s.is_active === 1) {
          updates[`cbt/sessions/${key}/is_active`] = 0;
          updates[`cbt/sessions/${key}/terminated_reason`] = 'new_login_on_different_device';
          updates[`cbt/sessions/${key}/terminated_at`] = new Date().toISOString();
        }
      });
      if (Object.keys(updates).length > 0) {
        await rtdb.ref().update(updates);
      }
    } catch (e) {
      console.error('[Firebase] terminateOldSessions error:', e.message);
    }
  },

  // Tests (Cloud Test Catalog)
  async saveTest(test) {
    const rtdb = initFirebase();
    if (!rtdb) return;
    const key = String(test.id || safeKey(test.test_code));
    await rtdb.ref(`cbt/tests/${key}`).set({
      ...test,
      updatedAt: new Date().toISOString()
    });
  },

  async getTests() {
    const rtdb = initFirebase();
    if (!rtdb) return [];
    try {
      const snap = await rtdb.ref('cbt/tests').once('value');
      const val = snap.val();
      if (!val) return [];
      return Object.values(val);
    } catch (e) {
      return [];
    }
  },

  async getTest(idOrCode) {
    const rtdb = initFirebase();
    if (!rtdb || !idOrCode) return null;
    try {
      const snap = await rtdb.ref(`cbt/tests/${idOrCode}`).once('value');
      if (snap.exists()) return snap.val();
      const codeKey = safeKey(idOrCode);
      const snap2 = await rtdb.ref(`cbt/tests/${codeKey}`).once('value');
      if (snap2.exists()) return snap2.val();
      const all = await this.getTests();
      return all.find(t => String(t.id) === String(idOrCode) || String(t.test_code).toLowerCase() === String(idOrCode).toLowerCase()) || null;
    } catch (e) {
      return null;
    }
  },

  async deleteTest(testId, testCode = null) {
    const rtdb = initFirebase();
    if (!rtdb) return;
    try {
      // Remove from active tests
      await rtdb.ref(`cbt/tests/${testId}`).remove();
      if (testCode) {
        await rtdb.ref(`cbt/tests/${safeKey(testCode)}`).remove();
        // Record in deleted_tests to prevent auto-re-seeding
        await rtdb.ref(`cbt/deleted_tests/${safeKey(testCode)}`).set({
          deletedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error('[Firebase] deleteTest error:', e.message);
    }
  },

  async isTestDeleted(testCode) {
    const rtdb = initFirebase();
    if (!rtdb || !testCode) return false;
    try {
      const snap = await rtdb.ref(`cbt/deleted_tests/${safeKey(testCode)}`).once('value');
      return snap.exists();
    } catch (e) {
      return false;
    }
  },

  // Submissions (Persistent Exam Records)
  async saveSubmission(submission) {
    const rtdb = initFirebase();
    if (!rtdb) return;
    const key = String(submission.id || Date.now());
    await rtdb.ref(`cbt/submissions/${key}`).set({
      ...submission,
      savedAt: new Date().toISOString()
    });
  },

  async getSubmission(id) {
    const rtdb = initFirebase();
    if (!rtdb || !id) return null;
    try {
      const snap = await rtdb.ref(`cbt/submissions/${id}`).once('value');
      if (snap.exists()) return snap.val();
      // Search all submissions
      const allSnap = await rtdb.ref('cbt/submissions').once('value');
      const val = allSnap.val();
      if (!val) return null;
      return Object.values(val).find(s => String(s.id) === String(id)) || null;
    } catch (e) {
      console.error('[Firebase] getSubmission error:', e.message);
      return null;
    }
  },

  async getSubmissions(testId = null) {
    const rtdb = initFirebase();
    if (!rtdb) return [];
    try {
      const snap = await rtdb.ref('cbt/submissions').limitToLast(200).once('value');
      const val = snap.val();
      if (!val) return [];
      let list = Object.values(val);
      if (testId) {
        list = list.filter(s => String(s.test_id) === String(testId));
      }
      return list.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
    } catch (e) {
      console.error('[Firebase] getSubmissions error:', e.message);
      return [];
    }
  },

  async getStudentSubmissions(userId) {
    const rtdb = initFirebase();
    if (!rtdb) return [];
    try {
      const snap = await rtdb.ref('cbt/submissions').once('value');
      const val = snap.val();
      if (!val) return [];
      return Object.values(val)
        .filter(s => String(s.user_id) === String(userId))
        .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
    } catch (e) {
      return [];
    }
  }
};

module.exports = firebaseStore;
