# Migration Changes: 2-Tier to 3-Tier

This document lists every change made during the migration, in the order they were made, with the exact before and after code, and the reason for each change.

---

## Overview of All Changes

| File | Action | Reason |
|---|---|---|
| `server/config/db.js` | Rewritten | Exported dead connection — replaced with live connection pool |
| `server/models/userModel.js` | Rewritten | Missing `updateUser` — added full CRUD, this is now the sole SQL boundary |
| `server/controllers/userController.js` | Rewritten | Missing `updateUser`, no validation — added full CRUD + input validation |
| `server/routes/userRoutes.js` | Rewritten | Missing PUT route, wrong path pattern — fixed full CRUD and mount path |
| `server/routes/users.js` | **Deleted** | Dead code with direct SQL in router — architectural violation |
| `server/server.js` | Rewritten | Had inline SQL and routes — stripped to bootstrap only (8 lines) |
| `server/app.js` | Rewritten | Unused, incomplete — became the single Express configuration owner |
| `nginx/nginx.conf` | **Created** | New file — Nginx now owns Tier 1 (static files + reverse proxy) |
| `Dockerfile` | Rewritten | Was a single Node.js build — now a multi-stage build: React builder + Nginx |
| `Dockerfile.server` | **Created** | New file — dedicated Dockerfile for the Express API (Tier 2 only) |
| `compose.yml` | Rewritten | Had 2 services (server + db) — now has 3 services (nginx + server + db) |
| `.env.example` | **Created** | No example file existed, credentials were hardcoded |
| `.gitignore` | Updated | `.env` was not excluded from version control |

---

## Change 1: `server/config/db.js` — Dead Connection → Live Pool

### Before
```javascript
const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'db',
  user: 'ibtisam',       // hardcoded credentials
  password: 'ibtisam',
  database: 'test_db'
});

db.connect(err => {
  if (err) { return; }
  console.log('Connected to the database.');
  db.query(`CREATE DATABASE IF NOT EXISTS test_db`, err => { ... });
  db.end();  // closes the connection here
});

module.exports = db;  // exports a connection that was just closed
```

### After
```javascript
require('dotenv').config({ path: __dirname + '/../../.env' });
const mysql = require('mysql2');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,       // credentials from environment variables
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.getConnection((err, connection) => {
  if (err) { process.exit(1); }         // fail fast on startup
  console.log('Database pool connected.');
  connection.release();                  // return to pool, not closed
});

module.exports = pool;  // exports a live, reusable connection pool
```

### Key Differences
- `createConnection` → `createPool`: A pool maintains multiple reusable connections. A single connection can only handle one query at a time; a pool handles concurrent requests.
- `db.end()` removed: The connection is never closed. It stays alive for the lifetime of the process.
- `connection.release()` instead of `connection.end()`: Returns the connection back to the pool for reuse.
- Hardcoded credentials → `process.env.*`: Credentials come from the `.env` file.

---

## Change 2: `server/models/userModel.js` — Incomplete → Full CRUD, Sole SQL Boundary

### Before
```javascript
const db = require('../config/db');

const getUsers = (callback) => {
  db.query('SELECT * FROM users', callback);
};

const addUser = (user, callback) => {
  db.query('INSERT INTO users SET ?', user, callback);  // shorthand INSERT — fragile
};

const deleteUser = (id, callback) => {
  db.query('DELETE FROM users WHERE id = ?', [id], callback);
};
// updateUser was completely missing

module.exports = { getUsers, addUser, deleteUser };
```

### After
```javascript
const db = require('../config/db');

// TIER 3 BOUNDARY — this is the ONLY file allowed to write SQL.

const getUsers = (callback) =>
  db.query('SELECT * FROM users', callback);

const getUserById = (id, callback) =>
  db.query('SELECT * FROM users WHERE id = ?', [id], callback);

const createUser = ({ name, email, role }, callback) =>
  db.query('INSERT INTO users (name, email, role) VALUES (?, ?, ?)', [name, email, role], callback);

const updateUser = (id, { name, email, role }, callback) =>
  db.query('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?', [name, email, role, id], callback);

const deleteUser = (id, callback) =>
  db.query('DELETE FROM users WHERE id = ?', [id], callback);

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser };
```

### Key Differences
- `addUser` renamed to `createUser`: Consistent naming with REST conventions (GET, CREATE, UPDATE, DELETE).
- `getUserById` added: New operation that was missing entirely.
- `updateUser` added: Was completely absent, forcing `server.js` to handle it inline with direct SQL.
- Explicit column names in INSERT: `INSERT INTO users (name, email, role) VALUES (?, ?, ?)` instead of `INSERT INTO users SET ?`. The explicit form is safer — `SET ?` passes the entire request body object to the database which could include unexpected fields.

---

## Change 3: `server/controllers/userController.js` — Partial → Full CRUD + Validation

### Before
```javascript
const userModel = require('../models/userModel');

const getUsers = (req, res) => {
  userModel.getUsers((err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

const addUser = (req, res) => {
  userModel.addUser(req.body, (err, result) => {  // passes entire req.body — no validation
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: result.insertId, ...req.body });
  });
};

const deleteUser = (req, res) => {
  userModel.deleteUser(req.params.id, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'User deleted' });
  });
};
// updateUser was missing — no way to handle PUT requests

module.exports = { getUsers, addUser, deleteUser };
```

### After
```javascript
const userModel = require('../models/userModel');

// TIER 2 — Application layer. Zero SQL here. Zero db imports.

const getUsers = (req, res) => {
  userModel.getUsers((err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

const getUserById = (req, res) => {
  userModel.getUserById(req.params.id, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results.length) return res.status(404).json({ error: 'User not found' });  // 404 added
    res.json(results[0]);
  });
};

const createUser = (req, res) => {
  const { name, email, role } = req.body;
  if (!name || !email || !role) {                          // input validation added
    return res.status(400).json({ error: 'name, email, and role are required' });
  }
  userModel.createUser({ name, email, role }, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: result.insertId, name, email, role });
  });
};

const updateUser = (req, res) => {                         // was completely missing
  const { name, email, role } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ error: 'name, email, and role are required' });
  }
  userModel.updateUser(req.params.id, { name, email, role }, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ id: req.params.id, name, email, role });
  });
};

const deleteUser = (req, res) => {
  userModel.deleteUser(req.params.id, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  });
};

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser };
```

### Key Differences
- Input validation added to `createUser` and `updateUser`: Returns `400 Bad Request` instead of passing bad data to the database.
- `affectedRows === 0` check added to `updateUser` and `deleteUser`: Returns `404 Not Found` when a non-existent ID is used, instead of silently returning `200 OK`.
- `updateUser` added: Was completely missing.
- `getUserById` added: Was completely missing.

---

## Change 4: `server/routes/userRoutes.js` — Incomplete → Full CRUD, Correct Mount Path

### Before
```javascript
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/users', userController.getUsers);    // path includes '/users'
router.post('/users', userController.addUser);    // path includes '/users'
router.delete('/users/:id', userController.deleteUser);
// PUT route was completely missing
// path '/users' was wrong — router was mounted at '/api' in app.js
// this made GET /api/users work but made /:id routes resolve to /api/users/:id incorrectly

module.exports = router;
```

### After
```javascript
const router = express.Router();
const controller = require('../controllers/userController');

// Router is mounted at /api/users in app.js
// So paths here are relative — '/' means /api/users, '/:id' means /api/users/:id
router.get('/',       controller.getUsers);      // GET    /api/users
router.get('/:id',   controller.getUserById);   // GET    /api/users/:id
router.post('/',     controller.createUser);    // POST   /api/users
router.put('/:id',   controller.updateUser);    // PUT    /api/users/:id  (was missing)
router.delete('/:id', controller.deleteUser);   // DELETE /api/users/:id

module.exports = router;
```

### Key Differences
- Paths changed from `/users` and `/users/:id` to `/` and `/:id`: The router is mounted at `/api/users` in `app.js`. Including `/users` in the router paths was redundant and created double-path issues.
- PUT route added: Was completely missing, meaning update operations had no route in the MVC path.

---

## Change 5: `server/routes/users.js` — Deleted

This file was deleted entirely.

### What it contained
```javascript
const db = require('../config/db');  // router importing database directly

router.get('/', (req, res) => {
  db.query('SELECT * FROM users', ...);  // SQL in router — 2-tier violation
});
// ... more direct SQL queries in router handlers
```

### Why it was deleted
1. It was never imported or mounted anywhere — it was completely dead code.
2. It contained `db.query()` directly in route handlers — a 2-tier violation.
3. Its existence implied there was a valid alternative to the MVC path, which was false.
4. Keeping dead code that violates the architecture creates confusion for anyone reading the codebase.

---

## Change 6: `server/server.js` — 100-line God File → 8-line Bootstrap

### Before (abbreviated)
```javascript
const express = require('express');
const mysql = require('mysql2');
const app = express();

// inline DB connection
const db = mysql.createConnection({ host: 'db', user: 'ibtisam', ... });
db.connect(...);

// all routes defined inline with direct SQL
app.get('/api/users', (req, res) => { db.query(...) });
app.post('/api/users', (req, res) => { db.query(...) });
app.put('/api/users/:id', (req, res) => { db.query(...) });
app.delete('/api/users/:id', (req, res) => { db.query(...) });

// serving static files
app.use(express.static(...));
app.get('*', (req, res) => { res.sendFile(...) });

app.listen(5000, ...);
```

### After
```javascript
require('dotenv').config({ path: __dirname + '/../../.env' });

const app  = require('./app');     // Express config (routes, middleware)
require('./config/db');            // initialise DB pool on startup

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
```

### Key Differences
- All inline SQL removed: Routes and database queries moved to their proper layers.
- All route definitions removed: Routes live in `routes/`, `controllers/`, `models/`.
- Static file serving removed: Nginx handles this (Tier 1).
- DB connection removed: `config/db.js` owns the connection.
- `server.js` now has exactly one job: start the process on a port.

---

## Change 7: `server/app.js` — Incomplete Wrapper → Single Express Config Owner

### Before
```javascript
const express = require('express');
const app = express();
const userRoutes = require('./routes/userRoutes');

app.use(express.json());
app.use(express.static('client/public'));  // static serving in API server

app.use('/api', userRoutes);  // wrong mount: made paths /api/users instead of /api/users

module.exports = app;
// this file was never used as the entry point — server.js ran its own app
```

### After
```javascript
require('dotenv').config(...);
const express    = require('express');
const cors       = require('cors');
const userRoutes = require('./routes/userRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/test', (req, res) => res.json({ message: 'API is working!' }));
app.use('/api/users', userRoutes);  // correct mount: router paths are now relative

// NO express.static() — Nginx serves static files
// NO app.get('*') catch-all — Nginx handles React Router fallback

module.exports = app;
```

### Key Differences
- `express.static()` removed: Static file serving is Tier 1, not Tier 2.
- Mount path corrected: `/api` → `/api/users` so router paths can be relative (`/` and `/:id`).
- `cors()` added: Required for the API to accept requests from Nginx.
- This file is now the single, authoritative Express configuration that `server.js` imports.

---

## Change 8: `nginx/nginx.conf` — Created

### Before
Did not exist. Express was serving static files.

### After
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;  # serve static files, fallback for React Router
    }

    location /api/ {
        proxy_pass http://server:5000;     # forward API requests to Express
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### What this achieves
- Nginx serves HTML, CSS, and JavaScript files directly from disk (Tier 1).
- All requests matching `/api/` are forwarded to the Express container at `http://server:5000`.
- `try_files $uri $uri/ /index.html` handles React Router — if a user navigates to `/users/3`, Nginx cannot find that file on disk and falls back to `index.html`, letting React handle the route client-side.
- Express never receives requests for static files.

---

## Change 9: `Dockerfile` — Single Build → Multi-Stage React + Nginx

### Before
```dockerfile
# Single image: Node.js builds React, then Node.js also runs the server
FROM node:18-alpine
WORKDIR /usr/src/app/client
COPY client/package*.json ./
RUN npm install --include=dev
COPY client/ ./
RUN npm run build

WORKDIR /usr/src/app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
RUN mkdir -p ./public && cp -R /usr/src/app/client/public/* ./public/

EXPOSE 5000
CMD ["npm", "start"]
# Result: one image containing both frontend build and backend server
```

### After
```dockerfile
# Stage 1: Build the React app
FROM node:18-alpine AS builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --include=dev
COPY client/ ./
RUN npm run build
# Output: /app/client/public/

# Stage 2: Nginx serves the build output
FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/client/public /usr/share/nginx/html
EXPOSE 80
# Result: a pure Nginx image with only static files — no Node.js, no source code
```

### Key Differences
- The final image contains zero Node.js. Just Nginx and the compiled static files.
- Source code is not in the image — only the compiled output.
- This image is Tier 1 only.

---

## Change 10: `Dockerfile.server` — Created

### Before
Did not exist. The server was built in the same Dockerfile as the frontend.

### After
```dockerfile
FROM node:18-alpine
WORKDIR /usr/src/app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
EXPOSE 5000
CMD ["npm", "start"]
```

This is a pure Node.js API image. No frontend files. No build tools. No webpack.

---

## Change 11: `compose.yml` — 2 Services → 3 Services

### Before
```yaml
services:
  server:  # one container running both API and static files
    ports: ["5000:5000"]  # exposed directly to the host
  db:
    # ...
```

### After
```yaml
services:
  nginx:   # Tier 1 — only service exposed to the outside
    ports: ["80:80"]
    depends_on: [server]

  server:  # Tier 2 — internal only
    expose: ["5000"]  # NOT ports — unreachable from the host
    depends_on:
      db:
        condition: service_healthy

  db:      # Tier 3 — internal only
    expose: ["3306"]  # NOT ports — unreachable from the host
```

### The `ports` vs `expose` distinction
- `ports: ["80:80"]` — maps a container port to the host machine. Anyone who can reach the host can reach this port.
- `expose: ["5000"]` — makes the port reachable only within the Docker network. Cannot be reached from outside the host.

This enforces the tier boundary at the network level: you can only reach the application through Nginx. Express and MySQL are invisible to the outside world.

---

## Final Architecture After All Changes

```
HTTP Request
    |
    | port 80 (only exposed port)
    v
Nginx (Tier 1 — Presentation)
    |-- serves /          -> returns index.html, bundle.js, CSS from disk
    |-- receives /api/*   -> proxy_pass to Express:5000
    |
    | internal Docker network only
    v
Express (Tier 2 — Application)
    |-- server.js         : start process, listen on port
    |-- app.js            : middleware + route mounting
    |-- routes/userRoutes : map HTTP verb + path to controller
    |-- controllers/      : parse request, validate input, send response
    |-- models/           : the only layer that writes SQL
    |
    | internal Docker network only
    v
MySQL (Tier 3 — Data)
    |-- init.sql seeds the schema on first run
    |-- data persisted in Docker volume
```
