# How to Read Any Node.js Codebase and Determine Its Architecture

This document is a practical guide for a DevOps engineer reviewing an unfamiliar Node.js project. You do not need to understand every line of code. You need to know **which specific patterns to look for** and **what each pattern means**.

---

## The 5-Minute Architecture Audit

When you receive a new Node.js project, follow these steps in order. Each step takes less than a minute.

---

### Step 1: Look at the Folder Structure (30 seconds)

Run `tree` or look at the folder listing. You are looking for these folders:

```
server/
├── routes/
├── controllers/
├── models/
└── config/
```

| What You See | What It Suggests |
|---|---|
| Only `routes/` exists (no `controllers/`, no `models/`) | Likely 2-tier — all logic probably in the routes |
| `routes/` + `controllers/` + `models/` all exist | Attempting 3-tier MVC — need to verify the chain is correct |
| Everything in a single `server.js` or `index.js` file | Almost certainly 2-tier — all logic in one file |
| `nginx/` folder or `nginx.conf` exists | 3-tier deployment — Nginx as presentation layer |
| One `Dockerfile` | Possibly tightly coupled — frontend and backend built together |
| `Dockerfile` + `Dockerfile.server` (or similar) | 3-tier deployment — separate build per tier |

**Important:** Folder structure alone is not proof. Folders named `controllers/` and `models/` can exist but contain code that violates the tier boundaries. Always verify with Step 2.

---

### Step 2: Find Where the Database is Called (1 minute)

This is the most important step. Run this command in the project directory:

```bash
grep -rn "db.query\|pool.query\|connection.query\|db.execute" server/
```

Look at the file paths in the results:

| Result | Meaning |
|---|---|
| Matches only in `server/models/` | 3-tier: DB access is properly isolated in the model layer |
| Matches in `server/routes/` | 2-tier violation: router talking directly to the database |
| Matches in `server/server.js` or `server/app.js` or `server/index.js` | 2-tier: main file doing everything |
| Matches in `server/controllers/` | Architectural violation: controller skipping the model layer |
| Matches in multiple locations | Inconsistent architecture: no single governing rule |

**This single grep command tells you more about the architecture than reading 500 lines of code.**

---

### Step 3: Read the Entry Point (1 minute)

Find the entry point. Check `package.json` in the server folder:

```json
{
  "scripts": {
    "start": "node server.js"   <-- this is the entry point
  }
}
```

Open that file and scan it quickly. You are looking for these specific things:

**Sign of 2-tier (bad):**
```javascript
// These lines in the entry point mean the file is doing too much
const db = mysql.createConnection({ ... });   // DB connection in entry point
db.connect(...);                              // DB connect in entry point
app.get('/api/users', (req, res) => {         // route defined in entry point
  db.query('SELECT * FROM users', ...);       // SQL in entry point
});
```

**Sign of 3-tier (good):**
```javascript
// A clean entry point — just bootstrapping
const app  = require('./app');        // delegates config to app.js
require('./config/db');              // delegates DB to config/db.js
app.listen(port, () => { ... });     // only job: start listening
```

**The rule:** If the entry point contains `db.query` or route definitions like `app.get('/api/...')`, the application is 2-tier regardless of what other files exist.

---

### Step 4: Check the Docker Setup (1 minute)

Open `compose.yml` (or `docker-compose.yml`) and count the services:

```yaml
services:
  nginx:    <-- Tier 1
  server:   <-- Tier 2
  db:       <-- Tier 3
```

| Number of Services | Deployment Architecture |
|---|---|
| 2 (app + db) | 2-tier deployment |
| 3 (nginx/frontend + app + db) | 3-tier deployment |
| 1 (everything in one container) | Monolith — single-tier deployment |

Also look at the `ports` vs `expose` keyword for each service:

```yaml
nginx:
  ports: ["80:80"]      # this is publicly accessible

server:
  expose: ["5000"]      # internal only — correct for Tier 2

db:
  expose: ["3306"]      # internal only — correct for Tier 3
```

If `server` or `db` uses `ports` instead of `expose`, the tier boundary is not enforced at the network level.

---

### Step 5: Check if the Backend Serves Static Files (30 seconds)

Search for this line in the backend code:

```bash
grep -rn "express.static" server/
```

| Result | Meaning |
|---|---|
| No matches | Tier 1 and Tier 2 are separate — correct 3-tier deployment |
| Match found in `app.js` or `server.js` | Backend is serving frontend — Tier 1 and Tier 2 are collapsed into one process |

If `express.static` exists in the backend, the deployment is 2-tier (one process doing both web server and API server jobs) regardless of whether a separate frontend folder exists.

---

## Pattern Reference Card

Use this as a quick reference when reading any file.

### When Reading `server.js` or `index.js` (Entry Point)

| Line You See | Meaning |
|---|---|
| `app.listen(port, ...)` | Normal — entry point starts the server |
| `const app = require('./app')` | Good — config is delegated to a separate file |
| `require('./config/db')` | Good — DB pool is initialized externally |
| `const db = mysql.createConnection(...)` | Warning — DB connection in entry point |
| `app.get('/api/...', ...)` | Bad — route defined in entry point (2-tier) |
| `db.query(...)` | Bad — SQL in entry point (2-tier) |
| `app.use(express.static(...))` | Bad — static file serving in API server (tier collapse) |

### When Reading `app.js` (Express Configuration)

| Line You See | Meaning |
|---|---|
| `app.use(cors())` | Normal — enables cross-origin requests |
| `app.use(express.json())` | Normal — parses JSON request bodies |
| `app.use('/api/users', userRoutes)` | Good — mounts router at a specific path |
| `app.use(express.static(...))` | Warning — if Nginx is present, this is a tier collapse |
| `app.get('*', res.sendFile(...))` | Warning — catch-all for React Router; should be in Nginx, not Express |
| `const db = require('./config/db')` | Bad — app config importing database directly |

### When Reading `routes/userRoutes.js` (Router)

| Line You See | Meaning |
|---|---|
| `router.get('/', controller.getUsers)` | Good — route just maps to a controller function |
| `router.get('/', (req, res) => { ... })` | Check what's inside the function |
| `const db = require('../config/db')` | Bad — router importing database directly (2-tier violation) |
| `db.query(...)` inside a route | Bad — SQL in router (2-tier violation) |

### When Reading `controllers/userController.js`

| Line You See | Meaning |
|---|---|
| `const userModel = require('../models/userModel')` | Good — controller delegates to model |
| `userModel.getUsers(...)` | Good — controller calling model |
| `req.params.id`, `req.body`, `res.json(...)`, `res.status(...)` | Good — HTTP concerns belong here |
| `if (!name \|\| !email) return res.status(400)...` | Good — input validation belongs here |
| `const db = require('../config/db')` | Bad — controller importing database directly (skipping model) |
| `db.query(...)` | Bad — SQL in controller (skipping model layer) |

### When Reading `models/userModel.js`

| Line You See | Meaning |
|---|---|
| `const db = require('../config/db')` | Good — model is the only layer that imports the DB |
| `db.query('SELECT * FROM users', ...)` | Good — SQL belongs here and only here |
| `req`, `res` anywhere in this file | Bad — model should have no knowledge of HTTP |
| `res.json(...)`, `res.status(...)` | Bad — response logic in model is a serious violation |

### When Reading `config/db.js`

| Line You See | Meaning |
|---|---|
| `mysql.createPool({ ... })` | Good — connection pool (handles concurrent requests) |
| `module.exports = pool` | Good — exports the live pool |
| `mysql.createConnection({ ... })` | Acceptable for simple apps, problematic for concurrent use |
| `db.end()` then `module.exports = db` | Bad — exports a closed connection (bug) |
| `process.env.DB_HOST`, `process.env.MYSQL_USER` | Good — credentials from environment variables |
| `host: 'localhost'`, `user: 'root'`, `password: 'password'` | Bad — hardcoded credentials |

### When Reading `nginx/nginx.conf`

| Line You See | Meaning |
|---|---|
| `proxy_pass http://server:5000` | Good — Nginx is forwarding API requests to Express |
| `try_files $uri $uri/ /index.html` | Good — React Router fallback handled at Tier 1 |
| `root /usr/share/nginx/html` | Good — static files served from disk by Nginx |
| `listen 80` | Good — Nginx handles all incoming traffic on port 80 |

---

## Architecture Decision Tree for DevOps

Use this when deciding how to structure Dockerfiles and Compose:

```
Is there an nginx.conf or nginx service in compose.yml?
├── YES → 3-tier deployment intended
│         Check: does express.static() still exist in app.js?
│         ├── YES → tier collapse, nginx config is not effective
│         └── NO  → correct 3-tier deployment
└── NO  → 2-tier deployment (frontend served by backend)
          Does db.query() appear only in models/?
          ├── YES → 3-tier code logic, 2-tier deployment
          └── NO  → 2-tier code logic AND 2-tier deployment

Based on result:
  2-tier code + 2-tier deploy → one Dockerfile, two Compose services (app + db)
  3-tier code + 2-tier deploy → one Dockerfile, two Compose services, but code is maintainable
  3-tier code + 3-tier deploy → two Dockerfiles, three Compose services (nginx + app + db)
```

---

## Summary

You do not need to read every line of a codebase to determine its architecture. You need to answer four questions:

1. **Where does `db.query()` appear?** — Only in `models/` = 3-tier logic. Anywhere else = 2-tier logic.
2. **What does the entry point do?** — Only `require` + `listen` = clean. Routes + SQL = 2-tier.
3. **Does `express.static()` exist in the backend?** — Yes = tier collapse. No = proper separation.
4. **How many services in `compose.yml`?** — 2 = 2-tier deployment. 3 with nginx = 3-tier deployment.

These four checks take under five minutes on any codebase and give you a complete picture of the architecture.
