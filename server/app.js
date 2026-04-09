// Express application configuration.
// This file owns: middleware setup, route mounting, static file serving.
// It does NOT start the server (that is server.js's responsibility).
// It does NOT connect to the database (that is config/db.js's responsibility).
require('dotenv').config({ path: __dirname + '/../../.env' });

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const userRoutes = require('./routes/userRoutes');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());          // Allow cross-origin requests from the React dev server
app.use(express.json()); // Parse incoming JSON request bodies

// ── API Routes ────────────────────────────────────────────────────────────────
// Health check — confirms the API process is running
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// All user CRUD routes delegated to the router
// Full paths: GET/POST /api/users, GET/PUT/DELETE /api/users/:id
app.use('/api/users', userRoutes);

// ── Static File Serving (Tier 1 delivery) ────────────────────────────────────
// Express serves the pre-built React app from client/public.
// In production, a dedicated web server (Nginx) would handle this instead.
app.use(express.static(path.join(__dirname, '../client/public')));

// Catch-all: return index.html for any non-API route so React Router works
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public', 'index.html'));
});

module.exports = app;
