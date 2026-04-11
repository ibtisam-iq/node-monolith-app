# Architecture Theory: 2-Tier vs 3-Tier

This document explains what 2-tier and 3-tier architectures actually mean, how to recognize them by reading code, and why the distinction matters for DevOps decisions like Dockerfile structure and Docker Compose design.

---

## The Core Principle

The number of "tiers" refers to the number of **independently responsible layers** in a system. The key word is **independently** — each tier must have exactly one job and must not do another tier's job.

---

## 2-Tier Architecture

### Definition

Two tiers: a **client** and a **database**. The client talks directly to the database with no application layer in between.

```
[Client / Application]  ──────────────────►  [Database]
   (all logic lives here)                    (data lives here)
```

### What It Looks Like in Code

In a 2-tier Node.js application, the route handler talks **directly** to the database:

```javascript
// THIS IS 2-TIER CODE
// The route (HTTP layer) is directly querying the database.
// There is no separate application layer between them.

app.get('/api/users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {  // <-- SQL inside a route handler
    res.json(results);
  });
});
```

**The tell-tale sign:** `db.query()` inside `app.get()`, `app.post()`, `router.get()`, or any route handler.

When you see a database query (`db.query`, `db.execute`, `pool.query`, `connection.query`) directly inside a route definition, that is a 2-tier system — regardless of how many folders exist.

### Real-World Example from This Project (Original `server.js`)

```javascript
// Original server.js — this was 2-tier
app.get('/api/users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {  // DB call in route = 2-tier
    res.json(results);
  });
});

app.post('/api/users', (req, res) => {
  const { name, email, role } = req.body;
  db.query('INSERT INTO users (name, email, role) VALUES (?, ?, ?)',  // DB call in route = 2-tier
    [name, email, role], (err, results) => {
    res.status(201).json({ id: results.insertId, name, email, role });
  });
});
```

---

## 3-Tier Architecture

### Definition

Three tiers: **Presentation**, **Application**, and **Data**. Each tier has exactly one responsibility.

```
[Tier 1: Presentation]  ──►  [Tier 2: Application]  ──►  [Tier 3: Data]
  React / Nginx               Express / Node.js            MySQL / PostgreSQL
  (UI and delivery)           (business logic)             (storage)
```

### The Inviolable Rule

> **No tier may skip another tier.**
>
> Tier 1 never talks to Tier 3 directly.
> Tier 2 (routes) never talks to Tier 3 (database) directly.
> Every request must travel through every layer in order.

### What It Looks Like in Code

In a proper 3-tier Node.js application, you will find **four separate files** for a single resource:

```
routes/userRoutes.js       → maps URL paths to controller functions (HTTP wiring only)
controllers/userController.js → handles HTTP request/response, calls model
models/userModel.js        → the ONLY file that contains SQL queries
config/db.js               → database connection pool
```

And the chain looks like this:

```javascript
// routes/userRoutes.js — ONLY wiring, no logic, no SQL
router.get('/', controller.getUsers);

// controllers/userController.js — HTTP logic, no SQL
const getUsers = (req, res) => {
  userModel.getUsers((err, results) => {   // calls the model, never the DB directly
    res.json(results);
  });
};

// models/userModel.js — the ONLY place SQL is written
const getUsers = (callback) => {
  db.query('SELECT * FROM users', callback);  // SQL only appears here
};
```

**The tell-tale sign of 3-tier:** `db.query()` appears **only** inside the `models/` folder. Nowhere else.

---

## The Deployment Dimension

Architecture has two dimensions that are often confused:

| Dimension | 2-Tier | 3-Tier |
|---|---|---|
| **Code architecture** | Routes query DB directly | Routes → Controller → Model → DB |
| **Deployment architecture** | App + DB on same or different servers | Frontend server + App server + DB server |

A system can be **3-tier in deployment** (three separate Docker containers) but **2-tier in code** (routes talking directly to the database). This was exactly the original state of this project.

The original `compose.yml` had two services (`server` and `db`) — but `server.js` had inline SQL in route handlers. So:
- Deployment: 2-tier (app container + db container)
- Code logic: 2-tier (routes → database directly)

After migration:
- Deployment: 3-tier (nginx container + server container + db container)
- Code logic: 3-tier (routes → controller → model → database)

---

## Quick Recognition Table

Use this table when reading any Node.js codebase to determine its architecture:

| What You See in the Code | What It Means |
|---|---|
| `db.query()` inside `app.get()` or `app.post()` | 2-tier: route talking directly to DB |
| `db.query()` inside `router.get()` or `router.post()` | 2-tier: router talking directly to DB |
| `db.query()` only inside `models/` folder | 3-tier: DB access properly isolated |
| `require('../config/db')` in a controller file | Architectural violation: controller skipping the model |
| `require('../config/db')` in a route file | Architectural violation: route skipping both controller and model |
| `app.use(express.static(...))` in the API server | Tier collapse: backend serving frontend files (not a pure 3-tier deployment) |
| Nginx with `proxy_pass` to Express | True 3-tier deployment: dedicated presentation layer |
| Single `Dockerfile` building both frontend and backend | Tightly coupled build: not independently deployable |
| Separate `Dockerfile` and `Dockerfile.server` | Independently deployable tiers: proper 3-tier deployment |

---

## Why This Matters for DevOps

As a DevOps engineer, knowing the tier architecture of a project directly determines:

1. **Dockerfile structure** — A 2-tier app needs one Dockerfile. A 3-tier app needs separate Dockerfiles for the frontend (Nginx) and backend (Node.js).

2. **Docker Compose design** — A 2-tier app has 2 services. A 3-tier app has 3 services: nginx, server, db.

3. **Port exposure** — In a 3-tier deployment, only Nginx should be exposed to the outside world (`ports`). Express and MySQL should be internal only (`expose`).

4. **Scaling decisions** — In a true 3-tier system, you can scale the application tier (Express) independently without touching the presentation tier (Nginx) or the data tier (MySQL).

5. **CI/CD pipeline design** — A 3-tier system needs separate build and test stages for the frontend and backend.
