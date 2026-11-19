require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for frontend deployment flexibility
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-screen-size']
}));

// Body parsers with generous limits for question payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'CBT Presenter Platform API'
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/admin', require('./routes/admin'));

// Static Client Application
const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

// SPA Fallback: All unmatched non-API routes serve index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Export app for serverless platforms (Vercel)
module.exports = app;

// Start Server and Initialize Database (for non-serverless environments)
async function bootstrap() {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`====================================================`);
      console.log(`  CBT PRESENTER & EXAM PLATFORM`);
      console.log(`  Server running on http://localhost:${PORT}`);
      if (process.env.ADMIN_EMAIL) {
        console.log(`  Admin Email configured: ${process.env.ADMIN_EMAIL}`);
      } else {
        console.log(`  Admin setup: Set ADMIN_EMAIL and ADMIN_PASSWORD in .env`);
      }
      console.log(`====================================================`);
    });
  } catch (err) {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap();
}
