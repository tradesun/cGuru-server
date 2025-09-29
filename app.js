// app.js
// Express bootstrap: CORS, JSON with raw body capture, shared routes, and server startup.
const express = require('express');
const fs = require('fs');
const path = require('path');
const scoreRoutes = require('./src/score.routes');
const { loadMockSubmissionsIfEnabled } = require('./src/mockLoader');
const app = express();
const port = 3000;

// CORS: allow all origins, methods, and common headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
 
// JSON parsing with raw body capture for webhook persistence
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Simple GET endpoint
app.get('/', (req, res) => {
  res.send('Hello World from Node.js API! 23');
});

// Mount shared routes (webhooks + future REST)
app.use('/', scoreRoutes);

// Start HTTP server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  // Optionally load mock submissions at startup (controlled by code flag)
  const load_mockup_submissions = false; // set to true to process local mock files
  loadMockSubmissionsIfEnabled(load_mockup_submissions);
});

