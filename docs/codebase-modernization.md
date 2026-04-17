# Codebase Modernization — Step 0

Before doing any DevSecOps work on this repository, I audited the inherited codebase, identified architectural problems, and modernized it into a proper 3-tier MVC structure.

> I used **AI-assisted analysis (Perplexity Pro)** to audit the dependency tree, identify outdated packages, and apply the correct architectural fixes.

> **Detailed migration documentation** for every change made is in [`docs/migration/`](./migration/README.md). Reading order: `01` → `02` → `03` → `05` → `06`.

---

## Source of This Codebase

This project originates from the **[node-monolith-2tier-app](https://github.com/ibtisam-iq/node-monolith-2tier-app)** repository — a flat 2-tier structure where the backend mixed route definitions, raw SQL queries, and static file serving in a single `server.js` file with no separation of concerns.

> What 2-tier vs 3-tier actually means and why the distinction matters: [`01-architecture-theory.md`](./migration/01-architecture-theory.md)

The frontend build pipeline also had a structural problem: `index.html` and `style.css` were manually placed inside `public/` and committed to Git, while webpack only generated `bundle.js`. The build was not the source of truth.

> Full audit of every problem found in the original codebase: [`02-original-problems.md`](./migration/02-original-problems.md)

---

## Backend Dependency Changes (`server/package.json`)

| What | Before | After | Why |
|---|---|---|---|
| `express` | `^4.18.2` | `^4.21.2` | Latest 4.x with security patches |
| `mysql2` | `^2.3.3` | `^3.11.3` | v3 rewrites the connection pool with better async support |
| `body-parser` | Present (standalone) | Removed | Bundled inside `express` since v4.16 — redundant dependency |
| `dotenv` | Missing | `^16.4.7` | Required for `.env` support; was not present in original |
| `cors` | `^2.8.5` | `^2.8.5` | Retained — still the correct package |

---

## Backend Architecture Refactor (2-tier → 3-tier MVC)

The original `server.js` had all CRUD routes and raw SQL inline. I restructured into clean MVC:

```
server.js             ← entry point only (env + listen)
app.js                ← Express config (middleware + route mounting)
routes/userRoutes.js  ← URL definitions
controllers/          ← request/response logic
models/userModel.js   ← SQL queries
config/db.js          ← connection pool (not a one-use connection)
```

### Active Code Path

The active entry point is `server.js` → `app.js` → `routes/` → `controllers/` → `models/` → `config/db.js`. Every layer has a single responsibility.

> Every backend change made during migration, with before/after comparisons: [`03-migration-changes.md`](./migration/03-migration-changes.md)

> General methodology for auditing and understanding an unfamiliar codebase: [`04-how-to-read-any-codebase.md`](./migration/04-how-to-read-any-codebase.md)

---

## Frontend Build Pipeline Modernization

The original `webpack.config.js` only compiled `src/index.js` into `public/bundle.js`. Two files — `index.html` and `style.css` — were manually placed in `public/` and committed to Git.

**Changes made:**

- Added `HtmlWebpackPlugin` → auto-generates `dist/index.html` from `src/index.html` template
- Added `MiniCssExtractPlugin` → extracts `dist/style.css` from `import './style.css'` in `index.js`
- Changed output path from `public/` to `dist/`
- Deleted `public/index.html` and `public/style.css` from Git
- Added `client/dist/` to `.gitignore`

Now `npm run build` is the single source of truth — `dist/` is 100% generated and never committed.

> Full frontend build pipeline refactor — why `public/` files were hand-placed, what was wrong, and how webpack now generates everything: [`05-frontend-build-modernization.md`](./migration/05-frontend-build-modernization.md)

> Step-by-step journal of every attempt to serve the decoupled frontend — Express static, Python HTTP server, Nginx — with every failure documented: [`06-frontend-serving-journey.md`](./migration/06-frontend-serving-journey.md)

---

## Frontend Dependency Changes (`client/package.json`)

| What | Change | Why |
|---|---|---|
| `html-webpack-plugin` | Added `^5.6.3` | Auto-generates `index.html` from template |
| `mini-css-extract-plugin` | Added `^2.9.2` | Extracts CSS into a separate file instead of injecting inline |
| `css-loader` | Added `^7.1.2` | Required to `import './style.css'` in JS |
| `file-loader` | Added `^6.2.0` | Handles image assets (e.g., `Youtube_Banner.png`) in webpack |
| `webpack` | `^5.75.0` → `^5.97.1` | Latest 5.x |
| `webpack-cli` | `^4.10.0` → `^6.0.1` | Latest CLI |
| `babel-loader` | `^9.1.0` → `^9.2.1` | Latest |
| `@babel/core` | `^7.20.12` → `^7.26.0` | Latest |
| `@babel/preset-env` | `^7.20.2` → `^7.26.0` | Latest |
| `axios` | `^1.2.2` → `^1.7.9` | Latest 1.x |

---

## Summary

| Area | Problem | Fix |
|---|---|---|
| Backend structure | All logic in one file, no separation | Full MVC refactor |
| Dependencies | Outdated, redundant `body-parser`, missing `dotenv` | Pinned latest, cleaned up |
| Hardcoded credentials | DB credentials in source code | Moved to `.env` via dotenv |
| Frontend build | Manual files committed to Git | Full webpack pipeline, `dist/` gitignored |
| Connection handling | Single `createConnection` per request | Persistent connection pool via `mysql2` |

> All of the above in a single combined reference: [`full-guide.md`](./migration/full-guide.md)
