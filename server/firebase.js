const admin = require('firebase-admin');

let db = null;
let isInitialized = false;

function initFirebase() {
  if (isInitialized) return db;

  // Option 1: Full service account JSON provided in environment
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
      isInitialized = true;
      console.log('[Firebase] Connected to Firestore via FIREBASE_SERVICE_ACCOUNT');
      return db;
    } catch (e) {
      console.error('[Firebase] Error parsing FIREBASE_SERVICE_ACCOUNT:', e.message);
    }
  }

  // Option 2: Individual environment variables
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Handle multiline private key from env
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
      db = admin.firestore();
      isInitialized = true;
      console.log('[Firebase] Connected to Firestore via Project ID:', process.env.FIREBASE_PROJECT_ID);
      return db;
    } catch (e) {
      console.error('[Firebase] Error initializing Firebase with individual keys:', e.message);
    }
  }

  // Option 3: Default application credentials (e.g. Google Cloud / Firebase hosting)
  if (process.env.FIREBASE_PROJECT_ID) {
    try {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID
      });
      db = admin.firestore();
      isInitialized = true;
      console.log('[Firebase] Connected to Firestore with default credentials for:', process.env.FIREBASE_PROJECT_ID);
      return db;
    } catch (e) {
      console.error('[Firebase] Default credential initialization error:', e.message);
    }
  }

  return null;
}

const firebaseStore = {
  isAvailable: () => {
    return !!initFirebase();
  },

  getDb: () => initFirebase(),

  // Users
  async saveUser(user) {
    const firestore = initFirebase();
    if (!firestore) return;
    await firestore.collection('users').doc(user.email.toLowerCase()).set({
      ...user,
      email: user.email.toLowerCase(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  async getUser(email) {
    const firestore = initFirebase();
    if (!firestore) return null;
    const doc = await firestore.collection('users').doc(email.toLowerCase()).get();
    return doc.exists ? doc.data() : null;
  },

  // Sessions
  async saveSession(session) {
    const firestore = initFirebase();
    if (!firestore) return;
    await firestore.collection('sessions').doc(String(session.id || session.token)).set({
      ...session,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  async getSessions() {
    const firestore = initFirebase();
    if (!firestore) return [];
    const snapshot = await firestore.collection('sessions').orderBy('last_ping_at', 'desc').limit(100).get();
    return snapshot.docs.map(doc => doc.data());
  },

  async terminateOldSessions(userId, currentToken) {
    const firestore = initFirebase();
    if (!firestore) return;
    const snapshot = await firestore.collection('sessions')
      .where('user_id', '==', userId)
      .where('is_active', '==', 1)
      .get();

    const batch = firestore.batch();
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.token !== currentToken) {
        batch.update(doc.ref, {
          is_active: 0,
          terminated_reason: 'new_login_on_different_device',
          terminated_at: new Date().toISOString()
        });
      }
    });
    await batch.commit();
  },

  // Submissions (Persistent Exam Records)
  async saveSubmission(submission) {
    const firestore = initFirebase();
    if (!firestore) return;
    await firestore.collection('submissions').doc(String(submission.id || Date.now())).set({
      ...submission,
      savedAt: new Date().toISOString()
    });
  },

  async getSubmissions(testId = null) {
    const firestore = initFirebase();
    if (!firestore) return [];
    let ref = firestore.collection('submissions');
    if (testId) {
      ref = ref.where('test_id', '==', testId);
    }
    const snapshot = await ref.orderBy('submitted_at', 'desc').get();
    return snapshot.docs.map(doc => doc.data());
  },

  async getStudentSubmissions(userId) {
    const firestore = initFirebase();
    if (!firestore) return [];
    const snapshot = await firestore.collection('submissions')
      .where('user_id', '==', userId)
      .orderBy('submitted_at', 'desc')
      .get();
    return snapshot.docs.map(doc => doc.data());
  }
};

module.exports = firebaseStore;
