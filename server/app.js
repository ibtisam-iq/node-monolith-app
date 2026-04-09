// Express application configuration — API only.
// This file owns: middleware, route mounting.
// It does NOT serve static files — Nginx owns that (see nginx/nginx.conf).
// It does NOT start the server — server.js owns that.
// It does NOT connect to the database — config/db.js owns that.
require('dotenv').config({ path: __dirname + '/../../.env' });

const express    = require('express');
const cors       = require('cors');
const userRoutes = require('./routes/userRoutes');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());         // Allow cross-origin requests
app.use(express.json()); // Parse incoming JSON request bodies

// ── API Routes ────────────────────────────────────────────────────────────────
// Health check — confirms the API process is alive
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// All user CRUD routes
// Full paths: GET/POST /api/users, GET/PUT/DELETE /api/users/:id
app.use('/api/users', userRoutes);

// ── No static file serving ────────────────────────────────────────────────────
// Express is Tier 2 (Application Layer) only.
// Static file delivery is Tier 1 — handled exclusively by Nginx.
// If you add express.static() here, you are collapsing Tier 1 into Tier 2.

module.exports = app;
