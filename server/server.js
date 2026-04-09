// Process entry point — bootstrap only.
// Responsibilities: load env, require app, require db pool, start listening.
// This file must contain NO route definitions and NO SQL.
// Rule: if a future developer adds a route here, that is an architectural violation.
require('dotenv').config({ path: __dirname + '/../../.env' });

const app  = require('./app');        // Express config (routes, middleware)
require('./config/db');               // Initialise the DB pool on startup — fail fast if DB is down

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
