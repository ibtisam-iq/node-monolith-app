# Frontend Serving Journey — From Confusion to Nginx

## Context

After completing the 2-tier → 3-tier backend migration (MVC refactor) and the frontend build pipeline modernization (webpack + plugins), the backend was running correctly and the database was connected. But a new problem appeared: **how do you actually view the frontend now?**

In the original 2-tier setup this question never came up. Once the 3-tier migration removed that coupling, the answer was no longer obvious.

This document is a step-by-step journal of every approach tried, every failure hit, and the exact commands that finally made everything work.

---

## The Problem — Frontend Was No Longer Served by the Backend

### How It Worked Before (2-tier, tightly coupled)

In the original codebase, `server.js` had a single line:

```js
app.use(express.static(path.join(__dirname, '../client/public')));
```

This meant Express served **both** the API and the frontend from the same process on port 5000. Running `node server/server.js` was enough — you could open `http://localhost:5000` and see the full UI.

Backend and frontend were tightly coupled. One process, one port, one URL.

### What Changed After the Migration (3-tier, decoupled)

During the MVC refactor, `server.js` was trimmed down to a clean entry point. The `express.static()` line was removed because the Express server should only handle API routes (`/api/*`), not static file serving. That is now Nginx's responsibility.

After the migration:
- `node server/server.js` starts the backend API on port 5000
- `http://localhost:5000` returns nothing useful for a browser — there is no UI there anymore
- The frontend static files exist in `client/dist/` after running `npm run build`, but nothing is serving them

The question became: **who serves `client/dist/` to the browser?**

---

## Attempt 1 — Let the Backend Serve the Frontend Again

### What Was Suggested

Add `express.static()` back into `server.js` or `app.js` pointing at `client/dist/`:

```js
app.use(express.static(path.join(__dirname, '../client/dist')));
```

### Why This Was Rejected

This would work technically, but it defeats the entire point of the 3-tier migration. A 3-tier architecture separates presentation, business logic, and data into independent layers. Serving static files from the Express server re-couples the presentation tier to the business logic tier — which is exactly the 2-tier pattern we just moved away from.

If the goal is to later containerize each tier independently, put Nginx behind a CDN, or scale the frontend and backend separately, mixing them into one process blocks all of that.

**Decision: Rejected. Proceed to a proper decoupled solution.**

---

## Attempt 2 — webpack-dev-server

### What Was Suggested

Install `webpack-dev-server` and update `package.json` to use it:

```bash
npm install --save-dev webpack-dev-server
```

```json
"scripts": {
  "start": "webpack serve --mode development --open"
}
```

This would start a dev server at `http://localhost:8080` with hot module replacement.

### What Went Wrong

This failed for two reasons:

**Reason 1 — `webpack-dev-server` was never installed.**
It was suggested as an `npm install` command but was not added to `package.json`. Since we were already managing other dependencies through `package.json`, having one package installed manually while others come from the manifest is inconsistent. Running `npm install` on a fresh clone would miss it.

**Reason 2 — `client/public/` was already deleted.**
At this stage, `client/public/index.html` and `client/public/style.css` had already been deleted from Git (part of the build pipeline modernization). But `webpack.config.js` still pointed its output to `public/` at that moment. So running the dev server produced a build with nowhere to write, and the browser got a blank page or a 404.

The real fix for the output path (`public/` → `dist/`) was applied during the webpack config modernization described in `05-frontend-build-modernization.md` — but at this exact point in the timeline, that change had not yet been made.

**Decision: Abandoned. The build pipeline needed to be fixed first, and webpack-dev-server is a development tool — not a production serving solution.**

---

## Attempt 3 — Python HTTP Server (Temporary Diagnostic Tool)

### What Was Tried

After the webpack build pipeline was fixed and `client/dist/` was being generated correctly, a quick way to verify the built files were valid was to serve them with Python's built-in HTTP server:

```bash
cd client/dist
python3 -m http.server 8080
```

Opening `http://localhost:8080` in the browser now loaded the page. The HTML rendered, the CSS was applied, and the page was visually correct.

### What Still Failed

The frontend UI loaded, but any user action that triggered an API call (create user, list users, delete) silently failed. The browser console showed CORS errors and failed fetch requests.

**Why:** The frontend JavaScript in `dist/bundle.js` makes API calls to `/api/users`. When served by `python3 http.server` on port 8080, those relative URLs resolve to `http://localhost:8080/api/users` — but the backend is on `http://localhost:5000/api/users`. Python's HTTP server has no proxy capability. It cannot forward `/api/` requests to Express.

### What This Confirmed

The built files are correct. The problem is not in the code — it is in the serving infrastructure. What is needed is a web server that can:
1. Serve static files from `client/dist/`
2. Proxy `/api/` requests to `http://localhost:5000`

That is exactly what a reverse proxy does. **The solution is Nginx.**

---

## The Real Solution — Nginx as Reverse Proxy

### Architecture

```
Browser
   │
   ▼
Nginx :80
   ├── GET /              → serves client/dist/index.html
   ├── GET /style.css     → serves client/dist/style.css
   ├── GET /bundle.js     → serves client/dist/bundle.js
   └── /api/*             → proxy_pass → Express :5000
                                  │
                                  ▼
                            MySQL :3306
```

One URL (`http://localhost`), two backends — Nginx routes requests to the right place.

### Step 1 — Install Nginx

```bash
sudo apt update && sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

Verify:
```bash
sudo systemctl status nginx
curl http://localhost
```

At this point `curl http://localhost` returns the default Nginx welcome page (`Welcome to nginx!`). This is expected — the custom config has not been applied yet.

### Step 2 — Write the Nginx Config

The config file lives in the repo at `nginx/default.conf`:

```nginx
server {
    listen 80;

    location / {
        root /home/ibtisam/node-monolith-app/client/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:5000/api/;
    }
}
```

**What each directive does:**

| Directive | Purpose |
|---|---|
| `listen 80` | Accept HTTP traffic on port 80 |
| `root ...client/dist` | Serve static files from the webpack build output |
| `index index.html` | Default file when a directory is requested |
| `try_files $uri $uri/ /index.html` | SPA fallback — if a file doesn't exist, serve `index.html` (handles client-side routing) |
| `proxy_pass http://localhost:5000/api/` | Forward all `/api/` requests to the Express server |

### Step 3 — Copy the Config and Remove the Default Site

```bash
sudo cp nginx/default.conf /etc/nginx/conf.d/default.conf
```

Test config syntax:
```bash
sudo nginx -t
```

Restart Nginx:
```bash
sudo systemctl restart nginx
```

Result: **Still showing the default Nginx welcome page.**

**Root cause:** Nginx ships with a default site enabled via a symlink at `/etc/nginx/sites-enabled/default`. This site also listens on port 80 and takes priority over configs in `conf.d/`. It must be removed.

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx
```

Result: **Now serving the correct page — but the page was blank or broken.**

### Step 4 — Fix File Permissions

Nginx runs as the `www-data` user. It needs read access to:
1. The home directory (`~`) — to traverse the path
2. The `client/dist/` folder — to read the files

**Step 4a — Make the home directory traversable:**

```bash
sudo chmod o+x ~
```

This grants execute (traverse) permission on `/home/ibtisam` to `other` users (which includes `www-data`). Without this, Nginx cannot enter the directory path at all.

**Step 4b — Make the dist folder and its files readable:**

```bash
sudo chmod -R o+r ~/node-monolith-app/client/dist
```

This recursively grants read permission on all files in `dist/` to `other` users.

**Step 4c — Restart Nginx to apply:**

```bash
sudo systemctl restart nginx
```

**Result: Frontend loads correctly in the browser.**

### Step 5 — Verify Everything End to End

```bash
# Backend API health check
curl http://localhost:5000/api/test
# Expected: { "message": "API is working!" }

# API data endpoint (served by Express, proxied through Nginx)
curl http://localhost/api/users
# Expected: JSON array of users from MySQL

# Frontend (served by Nginx directly)
curl http://localhost
# Expected: full HTML of index.html
```

Open in browser: `http://localhost` — the full application loads, and all CRUD operations work because `/api/` calls are transparently proxied to the Express backend on port 5000.

---

## Summary — What Failed and Why

| Attempt | What Was Tried | Why It Failed / Why It Was Rejected |
|---|---|---|
| 1 | Express serves static files | Re-couples frontend and backend — defeats the 3-tier architecture |
| 2 | webpack-dev-server | Package not in `package.json`; output path was wrong at that moment; development tool only |
| 3 | `python3 -m http.server 8080` | No proxy capability — `/api/` calls hit port 8080 instead of 5000; CORS failures |
| ✅ 4 | Nginx with `proxy_pass` | Serves static files AND proxies API — correct production architecture |

---

## Key Lessons

**1. Decoupling requires an intermediary.**
When you decouple frontend from backend, something must sit in front of both. That something is a reverse proxy. There is no way around this in a true 3-tier setup.

**2. Nginx's default site blocks custom configs.**
Nginx on Ubuntu/Debian ships with `/etc/nginx/sites-enabled/default` active. Any custom config in `conf.d/` will be silently ignored until the default site is removed.

**3. File permissions are a separate layer from config.**
A perfectly written nginx config will still serve 403 Forbidden if the `www-data` user cannot read the files. Both the directory path (`o+x` on parent directories) and the files themselves (`o+r` on the target folder) must be accessible.

**4. Python HTTP server is useful for diagnosis, not deployment.**
`python3 -m http.server` confirms that built files are valid and the HTML/CSS/JS is correct. It cannot replace a proper reverse proxy for anything involving API calls.
