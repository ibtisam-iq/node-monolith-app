# From 2-Tier to 3-Tier Architecture: A Complete Migration Guide

## Table of Contents

1. [What Is a Tier?](#1-what-is-a-tier-plain-english)
2. [The Original State: What Was Wrong](#2-the-original-state-what-was-wrong)
3. [How to Read Code and Identify the Tier Pattern](#3-how-to-read-code-and-identify-the-tier-pattern)
4. [The 3-Tier Target Architecture](#4-the-3-tier-target-architecture)
5. [File-by-File Migration: What Changed](#5-file-by-file-migration-what-changed)
6. [Files That Were Deleted](#6-files-that-were-deleted)
7. [Files That Were Added](#7-files-that-were-added)
8. [The Request Flow: Before vs After](#8-the-request-flow-before-vs-after)
9. [Docker Impact: Why Architecture Affects Dockerfiles](#9-docker-impact-why-architecture-affects-dockerfiles)
10. [Quick Reference: Code Signals That Tell You the Tier](#10-quick-reference-code-signals-that-tell-you-the-tier)

---

## 1. What Is a Tier?

A **tier** is a separate, independent layer of responsibility in an application. Think of it like a restaurant:

| Restaurant Role | Application Tier | Responsibility |
|---|---|---|
| Waiter (takes your order, brings food) | **Presentation Tier** | The UI — what the user sees and clicks |
| Chef (cooks the food, applies recipes) | **Application Tier** | The server — business logic, API, rules |
| Storage room / pantry (raw ingredients) | **Data Tier** | The database — stores and retrieves data |

Each layer **only talks to its immediate neighbor**. The waiter never walks into the pantry. The customer never talks directly to the chef. This separation is the entire point.

### 2-Tier vs 3-Tier

| | 2-Tier | 3-Tier |
|---|---|---|
| **Tiers** | Client + Database | Client + Application Server + Database |
| **Who writes SQL?** | The client or a single monolithic server that does everything | The Model layer inside the application server |
| **Separation** | Frontend and backend logic live together | Frontend, business logic, and data access are all separate |
| **Example** | A single `server.js` file that has `app.get('/users')` AND `db.query('SELECT * FROM users')` together | `routes` → `controllers` → `models` → `database` each in their own files |

---

## 2. The Original State: What Was Wrong

### The Original `server.js` (2-Tier Pattern)

This was the main file in the original codebase. Read it carefully:

```js
// server/server.js  — ORIGINAL (2-Tier / Monolithic)

const express = require('express');
const mysql = require('mysql2');
const app = express();

// Database connection — lives INSIDE server.js
const db = mysql.createConnection({
  host: 'db',
  user: 'ibtisam',
  password: 'ibtisam',
  database: 'test_db'
});

// Route AND SQL query in the SAME function — no separation
app.get('/api/users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {  // ← SQL directly here
    res.json(results);
  });
});

app.post('/api/users', (req, res) => {
  const { name, email, role } = req.body;
  db.query('INSERT INTO users (name, email, role) VALUES (?, ?, ?)', [name, email, role], ...);
  // ← Again, SQL directly inside the route handler
});
```

**Why is this 2-Tier?**

The route handler (`app.get(...)`) is doing **three jobs at once**:
1. Receiving the HTTP request (that is a routing job)
2. Deciding what to do with it (that is a controller/business logic job)
3. Writing and running the SQL query (that is a data access job)

All three responsibilities collapse into a single function. There is no boundary between "handle the request" and "talk to the database." This is the definition of tight coupling — and it is the hallmark of a 2-tier design.

### The Broken `app.js` (Incomplete 3-Tier Attempt)

The codebase also had an `app.js` that tried to be a 3-tier entry point:

```js
// server/app.js — ORIGINAL (attempted 3-tier, but broken)

const express = require('express');
const app = express();
const userRoutes = require('./routes/userRoutes');

app.use(express.json());
app.use(express.static('client/public')); // ← wrong path (relative, not absolute)
app.use('/api', userRoutes);

module.exports = app; // ← exports the app but never starts the server!
```

**Problems with this file:**
- It `module.exports = app` but nothing called `app.listen()`, so the server never actually started.
- The static file path `'client/public'` is relative and breaks when the process starts from a different directory.
- `server.js` and `app.js` both existed simultaneously — two competing entry points creating confusion about which one was actually running.

### The Broken `config/db.js` (Original Version)

```js
// server/config/db.js — ORIGINAL (broken)

const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'db',
  user: 'ibtisam',         // ← hardcoded credentials
  password: 'ibtisam',
  database: 'test_db'
});

db.connect(err => {
  // ...
  db.end(); // ← CLOSES the connection immediately after connecting!
});

module.exports = db; // ← exports a DEAD, closed connection
```

**The critical bug:** `db.end()` was called inside the `connect()` callback. This closes the connection right after it opens. Any other file that imported `config/db.js` received a closed, unusable database connection. This is why `server.js` created its own inline connection — it could not rely on this broken shared module.

### The Orphaned `routes/users.js` (Duplicate Dead Code)

```js
// server/routes/users.js — ORIGINAL (orphaned, never used correctly)

const db = require('../config/db'); // ← imports the broken, closed connection

router.get('/', (req, res) => {
  db.query('SELECT * FROM users', ...); // ← SQL directly in route, same 2-tier problem
});
```

This file was a leftover from an earlier refactor attempt. It:
- Still had SQL directly inside route handlers (2-tier pattern)
- Imported the broken `config/db.js` (would fail at runtime)
- Was never properly connected to `app.js` or `server.js`

### Summary of Original Problems

| Problem | Location | Impact |
|---|---|---|
| SQL queries inside route handlers | `server.js`, `routes/users.js` | No separation of concerns — 2-tier pattern |
| Two competing entry points | `server.js` + `app.js` | Confusion, unpredictable startup behavior |
| `db.end()` closing connection immediately | `config/db.js` | Any module importing `db.js` got a dead connection |
| Hardcoded credentials | `server.js`, `config/db.js` | Security risk, not portable across environments |
| Orphaned duplicate route file | `routes/users.js` | Dead code, maintenance confusion |
| Wrong static file path | `app.js` | Frontend would not be served correctly |

---

## 3. How to Read Code and Identify the Tier Pattern

This is the most important section for a DevOps engineer. When you open any Node.js/Express project, look for these specific signals.

### Signal 1: Where Is the SQL Query Written?

This is the **single most important indicator**.

```js
// RED FLAG — 2-Tier signal
// SQL is written directly inside a route handler
app.get('/api/users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => { // ← SQL here = 2-tier
    res.json(results);
  });
});
```

```js
// GREEN FLAG — 3-Tier signal
// Route handler calls a controller. Controller calls a model. Model has the SQL.
// routes/userRoutes.js
router.get('/users', userController.getUsers); // ← only routing here

// controllers/userController.js
const getUsers = (req, res) => {
  userModel.getUsers((err, results) => { // ← calls the model, no SQL here
    res.json(results);
  });
};

// models/userModel.js
const getUsers = (callback) => {
  db.query('SELECT * FROM users', callback); // ← SQL lives ONLY here
};
```

**Rule:** If you see `db.query(...)` or any SQL string (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) inside a file named `routes/` or directly in `server.js`/`app.js`, it is a 2-tier pattern.

### Signal 2: How Many Files Are in the `server/` Folder?

| Folder structure | Likely tier |
|---|---|
| Only `server.js` (or `app.js`) — nothing else | 2-Tier |
| `server.js` + `routes/` folder, but routes contain SQL | Still 2-Tier |
| `routes/` + `controllers/` + `models/` + `config/` all present AND each does only its own job | 3-Tier |

### Signal 3: Does `server.js` Import a Database Directly?

```js
// 2-Tier signal — server.js imports and uses mysql directly
const mysql = require('mysql2');
const db = mysql.createConnection({...}); // ← database inside server.js
```

```js
// 3-Tier signal — server.js only starts the server, nothing else
const app = require('./app');
app.listen(5000, () => console.log('Server running'));
// No mysql, no db, no SQL anywhere in this file
```

### Signal 4: Does `app.js` Do Only One Job?

In a proper 3-tier Node.js app:
- `app.js` → sets up Express middleware and mounts routes. Nothing else.
- `server.js` → imports `app` and calls `app.listen()`. Nothing else.
- `config/db.js` → creates and exports the database connection. Nothing else.
- `routes/` → maps URL paths to controller functions. No SQL, no business logic.
- `controllers/` → receives request, calls model, sends response. No SQL.
- `models/` → contains all SQL queries. No HTTP request or response objects.

---

## 4. The 3-Tier Target Architecture

After migration, the application follows this clean separation:

```
HTTP Request
     │
     ▼
┌─────────────────────────────────────────────────────┐
│  TIER 1 — PRESENTATION (React)                      │
│  client/src/                                        │
│  Makes HTTP calls to /api/users                     │
└─────────────────────┬───────────────────────────────┘
                      │ HTTP / JSON
                      ▼
┌─────────────────────────────────────────────────────┐
│  TIER 2 — APPLICATION (Node.js + Express)           │
│                                                     │
│  server.js  →  app.js  →  routes/userRoutes.js      │
│                               │                     │
│                               ▼                     │
│                    controllers/userController.js    │
│                               │                     │
│                               ▼                     │
│                    models/userModel.js              │
│                               │                     │
│                    config/db.js (connection pool)   │
└─────────────────────┬───────────────────────────────┘
                      │ SQL
                      ▼
┌─────────────────────────────────────────────────────┐
│  TIER 3 — DATA (MySQL)                              │
│  database/init.sql                                  │
│  Docker service: db                                 │
└─────────────────────────────────────────────────────┘
```

**Key rule of 3-tier:** Each tier only talks to its **immediate neighbor**. React never touches MySQL. `routes` never write SQL. `models` never read HTTP headers.

---

## 5. File-by-File Migration: What Changed

### `server/server.js` — Complete Rewrite

**Before (2-Tier):** Contained the database connection, all four CRUD route handlers with inline SQL, static file serving, and `app.listen()` — everything in one file.

**After (3-Tier):**
```js
// server/server.js — AFTER migration
require('dotenv').config();
const app = require('./app'); // ← just imports the configured Express app

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
```

**What this tells you:** `server.js` now has exactly ONE job — start the HTTP listener. It does not know about databases, routes, or business logic. Any Node.js project where `server.js` only contains `app.listen()` is following proper 3-tier structure.

---

### `server/app.js` — Fixed and Made the Central Configuration File

**Before (broken):** Had `module.exports = app` but no `app.listen()`, used a wrong relative static path, never actually ran.

**After (3-Tier):**
```js
// server/app.js — AFTER migration
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const userRoutes = require('./routes/userRoutes');

app.use(cors());
app.use(express.json());

// API routes — all routed to the routes layer
app.use('/api', userRoutes);

// Serve React build — correct absolute path
app.use(express.static(path.join(__dirname, '../client/public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public', 'index.html'));
});

module.exports = app;
```

**What changed:**
- `path.join(__dirname, ...)` replaces the broken relative path — `__dirname` is always the absolute path to the current file, so it works no matter where the process starts.
- No database code here. No SQL. App configuration only.
- `module.exports = app` is correct because `server.js` will import it and call `listen()`.

---

### `server/config/db.js` — Fixed the Closed Connection Bug

**Before (broken):** Called `db.end()` which closed the connection, then exported the dead connection.

**After (fixed):**
```js
// server/config/db.js — AFTER migration
require('dotenv').config();
const mysql = require('mysql');

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

db.connect(err => {
  if (err) {
    console.error('Database connection failed:', err.stack);
    return;
  }
  console.log('Connected to the database.');
  // ← db.end() REMOVED. Connection stays open for the lifetime of the app.
});

module.exports = db; // ← now exports a LIVE, open connection
```

**What changed:**
- `db.end()` removed entirely.
- Hardcoded credentials replaced with `process.env.*` environment variables.
- `require('dotenv').config()` added so the `.env` file is read.

**What this tells you:** In any Node.js app, if you see `config/db.js` (or `database.js` or `pool.js`) that does `module.exports = db` at the end without calling `.end()`, the database connection is properly shared across all modules.

---

### `server/routes/userRoutes.js` — No Changes Needed

This file was already correct:
```js
// server/routes/userRoutes.js
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/users', userController.getUsers);   // ← only routing, no SQL
router.post('/users', userController.addUser);
router.delete('/users/:id', userController.deleteUser);

module.exports = router;
```

**What this tells you:** A routes file should only map HTTP verbs and URL paths to controller functions. If you open a routes file and see `db.query(...)` anywhere in it, it is a 2-tier pattern regardless of what the folder is named.

---

### `server/controllers/userController.js` — No Changes Needed

This file was already correct:
```js
// server/controllers/userController.js
const userModel = require('../models/userModel');

const getUsers = (req, res) => {
  userModel.getUsers((err, results) => { // ← calls model, no SQL
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};
// ...
```

**What this tells you:** A controller file should only import from models and send HTTP responses. It should never import `mysql` or write SQL strings. If you see `require('mysql')` or `db.query(...)` in a controllers file, that responsibility has leaked down incorrectly.

---

### `server/models/userModel.js` — No Changes Needed

This file was already correct:
```js
// server/models/userModel.js
const db = require('../config/db');

const getUsers = (callback) => {
  db.query('SELECT * FROM users', callback); // ← SQL lives ONLY here
};

const addUser = (user, callback) => {
  db.query('INSERT INTO users SET ?', user, callback);
};

const deleteUser = (id, callback) => {
  db.query('DELETE FROM users WHERE id = ?', [id], callback);
};

module.exports = { getUsers, addUser, deleteUser };
```

**What this tells you:** The model is the only file in the entire application that is allowed to write SQL. If ALL SQL in a Node.js project lives only inside `models/`, the data access layer is properly separated. This is what makes it 3-tier.

---

## 6. Files That Were Deleted

### `server/routes/users.js` — DELETED

**Why it existed:** This was an older, incomplete version of the routes file, created during an earlier refactor attempt. It had SQL queries directly inside route handlers (2-tier pattern) and imported the broken `config/db.js`.

**Why it was deleted:**
- It duplicated functionality already handled by `routes/userRoutes.js` → `controllers/userController.js` → `models/userModel.js`.
- It was never imported by `app.js` or `server.js` in the correct version.
- Keeping it would cause confusion about which routes file was active.
- It represented the old 2-tier pattern and had no place in the 3-tier architecture.

**Rule:** If you find two route files for the same resource (e.g., `users.js` and `userRoutes.js` both in `routes/`), one of them is dead code from an incomplete migration.

---

## 7. Files That Were Added

### `docs/` folder — NEW

This entire documentation folder was created as part of the migration to give any engineer — developer or DevOps — a clear reference for what the codebase is, how it is structured, and why each decision was made.

---

## 8. The Request Flow: Before vs After

### Before (2-Tier) — A Single User GET Request

```
Browser clicks "Load Users"
        │
        │  GET /api/users
        ▼
  server.js  ←── Everything happens here
        │
        ├── Receives HTTP request        (routing job)
        ├── Decides what to do           (controller job)
        └── db.query('SELECT * FROM users')  (data access job)
                │
                ▼
           MySQL database
```

All three jobs collapsed into one function in one file. This is tight coupling.

### After (3-Tier) — The Same Request

```
Browser clicks "Load Users"
        │
        │  GET /api/users
        ▼
  server.js  ──▶  app.js  (starts server, mounts middleware)
                    │
                    ▼
          routes/userRoutes.js  (only job: match URL to controller)
                    │
                    ▼
     controllers/userController.js  (only job: handle request, call model)
                    │
                    ▼
          models/userModel.js  (only job: run SQL query)
                    │
                    ▼
          config/db.js  (only job: provide database connection)
                    │
                    ▼
             MySQL database
```

Each file has exactly one job. Changing the SQL query only touches `userModel.js`. Changing how the response is formatted only touches `userController.js`. Adding a new route only touches `userRoutes.js`. Nothing else needs to change.

---

## 9. Docker Impact: Why Architecture Affects Dockerfiles

This is directly relevant to DevOps decisions. The architecture determines how many Dockerfiles you need and how you structure `compose.yml`.

### Before (2-Tier / Tightly Coupled)

Because the frontend (React) static files were served directly by the Express backend (`app.use(express.static(...))`), there was only **one Dockerfile** for the entire application:

```dockerfile
# Single Dockerfile (2-tier / tightly coupled)
FROM node:18
WORKDIR /app
COPY . .
RUN cd client && npm install && npm run build
RUN cd server && npm install
CMD ["node", "server/server.js"]
# Frontend and backend bundled together in ONE image
```

**The problem:** You cannot scale the frontend independently. You cannot deploy the backend without rebuilding the frontend. One image change forces a full rebuild and redeploy of everything.

### After (3-Tier / Decoupled)

With proper 3-tier separation, you create **two Dockerfiles**:

```
Dockerfile.client   ←── builds and serves the React app (e.g., via Nginx)
Dockerfile.server   ←── runs only the Node.js API server
```

And `compose.yml` has three services:

```yaml
services:
  client:    # React app container
    build:
      dockerfile: Dockerfile.client
    ports: ["3000:80"]

  server:    # Node.js API container
    build:
      dockerfile: Dockerfile.server
    ports: ["5000:5000"]
    depends_on: [db]

  db:        # MySQL container
    image: mysql:8.0
```

**Why this matters for DevOps:**
- You can scale `server` independently from `client`.
- You can update the API without touching the frontend image.
- Each container has a single responsibility — exactly mirroring the 3-tier principle at the infrastructure level.
- CI/CD pipelines can build and test each layer independently.

**The rule:** 3-tier architecture in code → 3 containers in Docker. 2-tier / tightly coupled code → 1 or 2 containers. The number of Dockerfiles is a direct reflection of how well the application layers are separated.

---

## 10. Quick Reference: Code Signals That Tell You the Tier

Use this as a checklist when you open any new Node.js project.

### Open `server.js` or `app.js` First

| What you see | What it means |
|---|---|
| `db.query(...)` or `mysql.createConnection(...)` directly in this file | 2-Tier — database and server are coupled |
| `app.get('/api/...', (req, res) => { db.query(...) })` | 2-Tier — route + SQL in same function |
| `const app = require('./app'); app.listen(...)` | 3-Tier — server.js only starts the server |
| `app.use('/api', userRoutes)` and nothing else | 3-Tier — app.js only mounts routes |

### Check the `routes/` Folder

| What you see | What it means |
|---|---|
| `db.query(...)` inside a route handler | 2-Tier — data access leaked into routes |
| `router.get('/', controllerName.methodName)` | 3-Tier — routes only delegate to controllers |

### Check for `controllers/` and `models/` Folders

| What you see | What it means |
|---|---|
| No `controllers/` folder | Likely 2-Tier |
| `controllers/` exists but has `db.query(...)` in it | Partially refactored — still 2-tier behavior |
| `models/` exists and is the ONLY place with SQL strings | Proper 3-Tier |

### Check `config/db.js`

| What you see | What it means |
|---|---|
| `db.end()` called before `module.exports` | Bug — exports a closed, dead connection |
| Hardcoded credentials (`user: 'root'`, `password: 'secret'`) | Security risk — should use `process.env.*` |
| `process.env.DB_HOST`, `process.env.MYSQL_USER` etc. | Correct — credentials come from environment |
| `module.exports = db` at the end, no `.end()` call | Correct — live connection shared across modules |

---

*Documentation written as part of the architectural migration of this repository from a 2-tier monolithic pattern to a proper 3-tier MVC architecture.*
