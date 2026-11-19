const app = require('../server/server');
const { initDatabase } = require('../server/db');

let isInitialized = false;

module.exports = async (req, res) => {
  if (!isInitialized) {
    try {
      await initDatabase();
      isInitialized = true;
    } catch (e) {
      console.error('Database initialization on serverless startup error:', e);
    }
  }
  return app(req, res);
};
