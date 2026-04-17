# Understanding the Three-Tier Architecture

> **Why this document exists:** Before writing a single line in a Dockerfile,
> you must understand what you are containerizing. This document captures
> every architectural finding extracted from reading the project source code —
> so that the Dockerization decisions in `docker-setup.md` are fully justified.

---

## 1. The Big Mental Model: Local ≠ Docker

The single most important lesson from this project:

> **Running a project locally and running it via Docker are two completely
> different things. They share the same source code but have entirely
> different runtime environments.**

| Aspect | Local (bare metal) | Docker / Docker Compose |
|---|---|---|
| Node.js | Installed on your Mac | Bundled inside the image |
| MySQL | Installed on your Mac | Runs as a separate container |
| Frontend | Built by Webpack, served by Nginx or Python | Built inside a multi-stage image, served by Nginx container |
| Networking | `localhost` everywhere | Container names resolve as hostnames |
| Config files | Read from your filesystem | Copied into the image at build time |

**Why it matters:** When the project ran fine via Docker Compose but not
locally, it was because Docker was using Nginx to serve the frontend and
proxy API calls — exactly as designed. Locally, none of that infrastructure
existed yet.

---

## 2. Two-Tier vs Three-Tier — How to Tell From the Code

As a DevOps engineer, you will frequently receive a project and need to decide
how to Dockerize it. The answer always comes from reading the code.

### Two-Tier (what this project looked like before migration)

```
Browser → Express (serves BOTH static files AND API) → MySQL
```

**Code signal — `server.js` or `app.js` contains:**
```js
app.use(express.static(path.join(__dirname, '../client/public')));
```
This one line means Express is acting as both the web server (Tier 1) and the
application server (Tier 2). Both tiers are collapsed into a single process.

**Docker consequence:** You only need **one** Dockerfile for the entire
frontend + backend. The frontend is built and its output folder is copied into
the backend image. One container runs everything on one port.

---

### Three-Tier (what this project is now)

```
Browser → Nginx (Tier 1: static files + reverse proxy)
               → Express API (Tier 2: business logic)
                    → MySQL (Tier 3: data)
```

**Code signal — `app.js` contains NO `express.static()` call.** The comment
in this project's `app.js` makes it explicit:

```js
// ── No static file serving ──────────────────────────────────
// Express is Tier 2 (Application Layer) only.
// Static file delivery is Tier 1 — handled exclusively by Nginx.
// If you add express.static() here, you collapse Tier 1 into Tier 2.
```

**Docker consequence:** You need **two separate Dockerfiles** — one for the
frontend (multi-stage: build with Node, serve with Nginx) and one for the
backend (Node.js only). Plus a third service for MySQL. See `docker-setup.md`
for the full reasoning behind this decision.

---

## 3. Key Files and What They Tell You

### 3.1 `server/server.js` — The Entry Point

```js
require('dotenv').config({ path: __dirname + '/../../.env' });
const app  = require('./app');
require('./config/db');
const port = process.env.PORT || 5000;
app.listen(port, () => { ... });
```

**What it tells you:**

- This file is a **bootstrap only** — it loads env, wires up the app, and
  starts listening.
- It has **no routes** and **no SQL** — that is an architectural rule enforced
  by comments.
- The port is `5000` — this is what the backend Docker container must `EXPOSE`
  and what Nginx must `proxy_pass` to.
- The `.env` path goes two levels up (`/../../.env`) — in Docker, env vars
  are injected via `compose.yml`, so this path resolution is bypassed entirely.

---

### 3.2 `server/app.js` — Express Configuration

```js
app.use(cors());
app.use(express.json());
app.get('/api/test', ...);
app.use('/api/users', userRoutes);
// NO express.static() → confirmed three-tier
```

**What it tells you:**

- All routes are prefixed with `/api/` — this is the exact prefix Nginx must
  match in its `location /api/` block.
- CORS is enabled — during local development the frontend and backend run on
  different ports, so CORS is required. In Docker, Nginx reverse-proxies both
  on port 80, so they share the same origin and CORS is irrelevant (but harmless).
- **No static file serving** confirms the three-tier separation.
- `/api/test` is a lightweight test route — used as the healthcheck endpoint
  in `Dockerfile.server`.

---

### 3.3 `client/package.json` — The Build Commands

```json
"scripts": {
  "start": "webpack --mode development",
  "build": "webpack --mode production"
}
```

**What it tells you:**

- `npm start` is **not** a dev server. It runs Webpack once in development mode.
  It does **not** start `webpack-dev-server`. You cannot open `localhost:3000`
  after running it.
- `npm run build` produces the production-optimised bundle.
- **In the Dockerfile**, always use `npm run build` (production), never `npm start`.
- The presence of `react`, `react-dom`, `@babel/preset-react`, and `.babelrc`
  confirms this is a React project without `create-react-app` scaffolding.

---

### 3.4 `client/webpack.config.js` — The Build Pipeline

```js
output: {
  filename: 'bundle.js',
  path: path.resolve(__dirname, 'public'),  // ← output folder
  clean: true,
}
plugins: [
  new HtmlWebpackPlugin({ template: './src/index.html', filename: 'index.html' }),
  new MiniCssExtractPlugin({ filename: 'style.css' }),
]
```

**What it tells you:**

- The build output goes to `client/public/` — **not** `dist/`, **not** `build/`.
- Three files are produced: `bundle.js`, `index.html`, `style.css`.
- `clean: true` means the `public/` folder is **deleted and recreated** on
  every build. This is why `public/` does not exist in the repository — it is
  a generated artifact, not source code.
- **In `Dockerfile.client` (Stage 2):** `COPY --from=client-build` must point
  to `client/public/` — not `dist/`.
- **For Nginx** (`docker.conf`): the `root` directive must point to wherever
  this `public/` folder lands inside the container (`/usr/share/nginx/html`).

---

### 3.5 `client/src/api/users.js` — The Critical Routing Clue

```js
// const API_URL = 'http://localhost:5000/api/users'; // bare-metal only
const API_URL = '/api/users'; // relative — works through Nginx proxy
```

**This one change is what made three-tier work in Docker.** Here is why:

| Value | Works when… | Breaks when… |
|---|---|---|
| `http://localhost:5000/api/users` | Backend and frontend on same machine, different ports (local dev) | Inside Docker — `localhost` in the browser means the user's machine, not the backend container |
| `/api/users` (relative URL) | Nginx proxies `/api/` to the backend container | Never — relative URLs always go to the current host, which is Nginx on port 80 |

**The flow with relative URL:**
```
Browser fetches /api/users
  → hits Nginx on port 80
  → Nginx matches location /api/
  → proxy_pass to http://server:5000/api/
  → Express handles it
  → response flows back through Nginx to browser
```

**What this tells you for future projects:** When you see a hardcoded
`localhost:PORT` in the frontend API file, that project is designed for
local-only access. To Dockerize it properly for three-tier, the URL must
be made relative so Nginx can proxy it.

---

### 3.6 `nginx/docker.conf` — The Traffic Router

```nginx
server {
    listen 80;

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://server:5000/api/;
    }
}
```

**What it tells you:**

- Nginx listens on port **80** — the only port the outside world accesses.
- `location /` serves static files (the React build output) from
  `/usr/share/nginx/html` — Nginx's default static content directory.
- `location /api/` proxies to Express on port `5000` using the Docker Compose
  service name `server` (not `localhost`).
- `try_files $uri $uri/ /index.html` enables **client-side routing** — if a
  URL like `/users/42` doesn't match a file, Nginx falls back to `index.html`
  and lets React Router handle it.

> **Note:** The repo also contains `nginx/default.conf` — this is for local
> bare-metal use. In Docker, `Dockerfile.client` copies `nginx/docker.conf`
> (not `default.conf`) into the Nginx image, because container networking
> requires service names, not `localhost`.

---

## 4. Why Nginx in Three-Tier — The Purpose

Adding Nginx is not cosmetic. Before three-tier, Express was serving both
static files and the API from port 5000:

```
Browser → Express:5000 (handles everything)
```

This works, but it means Express — an application server — is also doing
the job of a web server. Web servers are optimised for static file delivery;
Node.js is not.

After three-tier with Nginx:

```
Browser → Nginx:80
              ├── GET /           → serves React build (static, fast)
              └── GET /api/*      → proxy_pass → Express:5000
```

Now Express only handles API logic. Nginx handles static delivery at its
native performance. **If Nginx were added without removing `express.static()`
from the backend, Nginx would exist but traffic would still route through
Express for static files — Nginx would be meaningless.**

---

## 5. The `public/` Folder — When and Why It Appears

`client/public/` does not exist in the repository. It is created by running:

```bash
npm run build       # production mode
```

Webpack reads `webpack.config.js`, processes `src/index.js`, and outputs to
`path.resolve(__dirname, 'public')`:

- `bundle.js` → compiled + bundled JavaScript
- `index.html` → generated from `src/index.html` template by HtmlWebpackPlugin
- `style.css` → extracted from all CSS imports by MiniCssExtractPlugin

> **Rule:** Never commit `public/` to Git. It is a build artifact. In Docker,
> it is produced during Stage 1 of `Dockerfile.client` and copied to the
> Nginx stage.

---

## 6. Tier Responsibilities

| Tier | Technology | Responsibility | Port |
|---|---|---|---|
| Tier 1 — Presentation | Nginx | Serves static React build, reverse-proxies `/api/` | 80 (host-exposed) |
| Tier 2 — Application | Express (Node.js) | REST API, business logic, DB queries | 5000 (internal only) |
| Tier 3 — Data | MySQL | Persistent storage | 3306 (internal only) |

Each tier is independent. Each has its own Dockerfile (or service in
`compose.yml`). Each can be scaled, replaced, or updated without touching
the others.

---

## 7. How to Read Any New Project — Decision Checklist

When you receive a new Node.js project and need to Dockerize it:

**Step 1 — Check `server.js` or `app.js`:**
- Has `express.static()`? → **Two-tier.** One Dockerfile covers frontend + backend.
- No `express.static()`? → **Three-tier.** Separate Dockerfiles needed.

**Step 2 — Check `client/package.json` scripts:**
- What does `build` do? → This is the command your Dockerfile will call.
- Is there `webpack-dev-server` or `vite` in devDependencies? → `start` runs a live dev server — never use `start` in Docker.

**Step 3 — Check `webpack.config.js`:**
- What is `output.path`? → This folder is what your Nginx `COPY --from` must point to.
- `HtmlWebpackPlugin` present? → `index.html` is generated. `MiniCssExtractPlugin` present? → CSS is extracted. Nginx needs all of these.

**Step 4 — Check the frontend API file (`src/api/*.js`):**
- Relative URL (`/api/users`)? → Already Nginx-compatible.
- Absolute URL (`http://localhost:5000/api/users`)? → Must change to relative for Docker.

**Step 5 — Check `server.js` for the port:**
- `process.env.PORT || 5000` → Dockerfile must `EXPOSE 5000`. Nginx `proxy_pass` must use the same port.

**Step 6 — Check if there is an Nginx config:**
- Exists for local use? → Write a separate `docker.conf` with service names instead of `localhost`.
- Doesn't exist at all? → Write one. Frontend gets `location /`, API gets `location /api/` with `proxy_pass`.
