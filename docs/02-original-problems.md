# Original Codebase Problems

This document describes the exact state of the codebase **before** migration. Every problem is listed with the specific file, the specific lines, and a clear explanation of why it was a problem.

---

## Summary of the Original State

The project was named `2TierUserApp` but the actual situation was more nuanced:

- **Deployment:** 2 Docker containers (app + db) — genuinely 2-tier deployment
- **Code logic:** Inconsistently layered — some paths were 2-tier, one path was attempting 3-tier but was broken
- **Result:** Not a clean 2-tier, not a clean 3-tier — the worst possible state: **inconsistent architecture with no single governing rule**

---

## Problem 1: Inline SQL in `server.js` (2-tier violation)

**File:** `server/server.js`

**The code:**
```javascript
// server.js was doing EVERYTHING:
// - creating the Express app
// - connecting to the database
// - defining route handlers
// - writing SQL queries directly in routes
// - starting the server
// - serving static files

app.get('/api/users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {  // SQL in route handler
    res.json(results);
  });
});

app.post('/api/users', (req, res) => {
  const { name, email, role } = req.body;
  db.query('INSERT INTO users (name, email, role) VALUES (?, ?, ?)',   // SQL in route handler
    [name, email, role], (err, results) => {
    res.status(201).json({ id: results.insertId, name, email, role });
  });
});
```

**Why this is a problem:**
The route handler is the HTTP layer. Its job is to receive an HTTP request and send an HTTP response. When it directly calls `db.query()`, it is skipping the application layer entirely and talking to the database directly. This is textbook 2-tier: client → database.

There is also no input validation — anyone could send a POST request with missing fields and receive a database error instead of a proper `400 Bad Request`.

---

## Problem 2: Inline SQL in `routes/users.js` (second 2-tier violation)

**File:** `server/routes/users.js`

**The code:**
```javascript
const db = require('../config/db');  // Router importing DB directly — violation

router.get('/', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {  // SQL in router — violation
    res.json(results);
  });
});

router.post('/', (req, res) => {
  db.query('INSERT INTO users (name, email, role) VALUES (?, ?, ?)',  // SQL in router
    [name, email, role], (err) => {
    res.sendStatus(201);
  });
});
```

**Why this is a problem:**
This is the same violation as Problem 1, just inside an Express Router instead of directly on the app. The router imports `config/db` directly — this means the routing layer has knowledge of the database, which violates the tier boundary. The router's only job is to map HTTP verbs and paths to handler functions.

This file was also **never actually used** — it was dead code. It was never imported or mounted in `server.js` or `app.js`. But its existence created confusion about which implementation was canonical.

---

## Problem 3: `config/db.js` Exported a Dead Connection

**File:** `server/config/db.js`

**The code:**
```javascript
const db = mysql.createConnection({ ... });

db.connect(err => {
  if (err) { return; }
  console.log('Connected to the database.');

  db.query(`CREATE DATABASE IF NOT EXISTS test_db`, err => { ... });

  db.end();  // <-- THIS LINE CLOSES THE CONNECTION
});

module.exports = db;  // <-- exports a connection that was just closed
```

**Why this is a problem:**
`db.end()` closes the database connection. The `module.exports = db` line then exports that closed connection object. Any file that did `require('../config/db')` received a dead connection that would fail on the first query.

This is why the `models/userModel.js` path was broken in practice, even though it looked correct structurally. The model imported `config/db`, got a dead connection, and any query would fail.

The reason the application appeared to work at all was that `server.js` created its own **separate** inline database connection and never used `config/db`.

---

## Problem 4: Three Competing Implementations

**Files:** `server/server.js`, `server/routes/users.js`, `server/routes/userRoutes.js` + `server/controllers/` + `server/models/`

The codebase had three completely separate implementations of the same user CRUD functionality:

| Implementation | Files | State |
|---|---|---|
| Inline in `server.js` | `server.js` | Active — this was the one actually running |
| Router with direct SQL | `routes/users.js` | Dead code — never imported, never used |
| MVC pattern | `routes/userRoutes.js` + `controllers/` + `models/` | Structurally correct but broken due to Problem 3 |

**Why this is a problem:**
When three implementations of the same thing exist, there is no single architectural rule governing the system. A new team member (or a DevOps engineer reviewing the code) cannot determine which implementation is canonical. Any change made to one implementation does not affect the others, leading to bugs and inconsistency.

---

## Problem 5: Missing CRUD Operations

**File:** `server/models/userModel.js`, `server/controllers/userController.js`, `server/routes/userRoutes.js`

The MVC path (which was the correct architectural direction) was **incomplete**:

| Operation | `server.js` (inline) | MVC path (routes/controller/model) |
|---|---|---|
| GET all users | ✅ | ✅ |
| GET user by ID | ❌ | ❌ |
| POST create user | ✅ | ✅ |
| PUT update user | ✅ | ❌ missing |
| DELETE user | ✅ | ✅ |

`updateUser` was completely absent from the model, controller, and routes in the MVC path. This forced `server.js` to continue existing because the MVC path could not replace it.

---

## Problem 6: Hardcoded Credentials

**Files:** `server/server.js`, `server/config/db.js`

```javascript
// Credentials hardcoded directly in source code
const db = mysql.createConnection({
  host: 'db',
  user: 'ibtisam',
  password: 'ibtisam',
  database: 'test_db'
});
```

The `.env`-based approach existed but was commented out in both files. The actual `.env` file was also committed to the repository (it appeared in the file listing), which means database credentials were in version control.

---

## Problem 7: Express Serving Static Files (Tier Collapse)

**File:** `server/server.js`

```javascript
// Express was doing the job of a web server
app.use(express.static(path.join(__dirname, '../client/public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public', 'index.html'));
});
```

**Why this is a problem:**
Serving static files (HTML, CSS, JavaScript bundles) is the job of Tier 1 — the presentation layer. When Express (Tier 2, the application layer) serves static files, it collapses Tier 1 and Tier 2 into a single process. This means:

- The application server and the web server cannot be scaled independently
- There is no dedicated, high-performance static file server (Nginx serves static files significantly faster than Node.js)
- The deployment is 2-tier (one container handling both presentation and application), not 3-tier

---

## Problem 8: Dual Entry Points

**Files:** `server/server.js` and `server/app.js`

`server.js` created its own Express app, connected to the database, defined routes, and called `app.listen()` — it was a complete, self-contained application.

`app.js` also created an Express app, imported `userRoutes`, and exported the app — but was never used as an entry point.

Two files both claiming to be the application entry point, with two different Express app instances, two different configurations, and no clear ownership of any responsibility.

---

## Visual Summary of Original Architecture

```
BROWSER
   |
   | HTTP request to port 5000
   |
   v
server.js  (doing EVERYTHING)
   |-- creates Express app
   |-- connects to MySQL directly (inline connection)
   |-- defines all routes
   |       |-- GET /api/users  --> db.query() --> MySQL   (2-tier path)
   |       |-- POST /api/users --> db.query() --> MySQL   (2-tier path)
   |       |-- PUT /api/users  --> db.query() --> MySQL   (2-tier path)
   |       |-- DELETE /api/users -> db.query() -> MySQL  (2-tier path)
   |-- serves static React files (tier collapse)
   |-- starts the server

app.js  (UNUSED as entry point)
   |-- creates second Express app
   |-- mounts userRoutes (which points to controller -> model)
   |-- model uses config/db (which exports a DEAD connection)
   |-- this entire path is broken and unreachable

routes/users.js  (DEAD CODE - never imported)
   |-- router with direct db.query() calls
   |-- would be a 2-tier violation if it were active

result: server.js runs everything, all other structure is decoration
```
