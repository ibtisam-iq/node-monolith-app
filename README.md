# Node Monolith Application

## Overview

This is a Node.js-based monolithic user management web application used as the **source codebase** for building real-world DevSecOps pipelines and platform engineering workflows.

I did not build this application from scratch. As a DevOps Engineer, my focus is on everything that happens **around the code** — building, securing, packaging, and running it in production-like environments using industry-standard tooling.

---

## Application Structure

```
node-monolith-app/
├── client/                         # React frontend (Webpack-bundled)
│   ├── src/
│   │   ├── App.js
│   │   ├── api/users.js            # Axios HTTP calls to backend API
│   │   └── components/             # UsersList, UserItem
│   ├── public/                     # Static assets served by Express
│   ├── package.json                # React 18, Axios, Webpack, Babel
│   └── webpack.config.js
├── server/                         # Node.js + Express backend
│   ├── server.js                   # Entry point — loads env, starts listener
│   ├── app.js                      # Express config — routes, middleware
│   ├── config/db.js                # MySQL2 connection pool
│   ├── routes/userRoutes.js        # Route definitions
│   ├── controllers/userController.js
│   ├── models/userModel.js
│   └── package.json                # Express, MySQL2, dotenv, cors
├── database/
│   └── init.sql                    # Schema bootstrap
├── nginx/                          # Nginx reverse proxy config
├── docs/                           # Architecture docs, migration notes
├── .env.example                    # Environment variable template
├── Dockerfile
└── compose.yml
```

Three-tier architecture: Presentation (React SPA) → Business Logic (Express + MVC) → Data (MySQL).

---

## Technology Stack

| Layer | Technology |
|---|---|
| Language | JavaScript (Node.js 22) |
| Frontend Framework | React 18 |
| Frontend Bundler | Webpack 5 + Babel |
| HTTP Client | Axios |
| Backend Framework | Express 4 |
| Database Driver | mysql2 |
| Database | MySQL 8 |
| Reverse Proxy | Nginx |
| Environment | dotenv |
| Build Tool | npm |

---

## DevOps Implementation Journey

### Step 0 — Codebase Modernization (`package.json`)

The inherited codebase was functional but architecturally inconsistent — originally closer to a 2-tier structure where the backend mixed route definitions, SQL queries, and static file serving in a single file with no separation of concerns. Before doing any DevOps work, I audited the code, refactored it into a proper 3-tier MVC architecture, and modernized all dependencies.

> **Note:** I used **AI-assisted analysis (Perplexity Pro)** to audit the dependency tree, identify outdated packages, and apply the correct architectural fixes.

**Changes made to `server/package.json`:**

| What | Before | After | Why |
|---|---|---|---|
| `express` | `^4.18.2` | `^4.21.2` | Latest 4.x with security patches |
| `mysql2` | `^2.3.3` | `^3.11.3` | v3 rewrites the connection pool with better async support |
| `body-parser` | Present (standalone) | Removed | Bundled inside `express` since v4.16 — redundant dependency |
| `dotenv` | Missing | `^16.4.7` | Required for `.env` support; was not present in original |
| `cors` | `^2.8.5` | `^2.8.5` | Retained — still the correct package |

**Architecture refactor (2-tier → 3-tier):**

The original `server.js` had all CRUD routes and raw SQL inline. I restructured the backend into a clean MVC pattern:

```
server.js       ← entry point only (env + listen)
app.js          ← Express config (middleware + route mounting)
routes/         ← URL definitions
controllers/    ← request/response logic
models/         ← SQL queries
config/db.js    ← connection pool (not a one-use connection)
```

> **Further reading:** All architectural decisions, original problems, and migration details are documented in [`docs/migration`](./docs/migration).

---

### Step 1 — Environment Standardization

The original codebase had hardcoded database credentials directly in `config/db.js` and `server.js`. I refactored the entire application to read all config from environment variables, making it portable across all environments.

```bash
# Copy the template and fill in real values
cp .env.example .env
```

Key variables set in `.env`:

```env
MYSQL_ROOT_PASSWORD=your_root_password
MYSQL_DATABASE=test_db
MYSQL_USER=your_username
MYSQL_PASSWORD=your_password
DB_HOST=db
PORT=5000
```

> **Note:** `DB_HOST` must be set to `db` when running via Docker Compose (Docker resolves the service name as a hostname on the internal network). For local bare-metal runs without Docker, set it to `localhost`.

---

### Step 2 — Local Build & Validation

Before building any pipeline, I validated the full application lifecycle locally.

**Install and configure MySQL:**

```bash
sudo apt update && sudo apt install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql

# Secure and create DB user
sudo mysql -u root -p
```

```sql
CREATE DATABASE test_db;
CREATE USER 'your_username'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON test_db.* TO 'your_username'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**Verify MySQL is running and the database exists:**

```bash
# Check MySQL is running
sudo systemctl status mysql

# Confirm the database exists
mysql -u your_username -p -e "SHOW DATABASES;" | grep test_db
```

**Install dependencies and run the server:**

```bash
# Install server dependencies
cd server && npm install

# Install client dependencies and build the React bundle
cd ../client && npm install && npm run build

# Load env vars and start the server
cd ..
set -a && source .env && set +a
node server/server.js
```

> **Why `set -a`?** `set -a` marks every variable sourced from `.env` for automatic export into the child process (Node.js). `set +a` turns off the flag after sourcing so subsequent shell variables are not unintentionally exported.

> **Note:** The React app must be built (`npm run build`) before starting the server. Express serves the compiled static files from `client/public/`. Running the server without building first will result in a blank frontend.

App runs at: `http://localhost:5000`

---

### Step 3 — DevSecOps Pipelines (CI/CD)

With the application validated locally, I built automated pipelines to transform this code into a secure, deployable artifact.

Pipelines include: npm build → SonarQube analysis → Trivy vulnerability scan → Docker image build → Nexus artifact management → Jenkins & GitHub Actions automation.

👉 **Pipelines repository:** [DevSecOps Pipelines](https://github.com/ibtisam-iq/devsecops-pipelines/tree/main/pipelines/node-monolith)

---

### Step 4 — Platform Engineering (Deployment & Operations)

Once the artifact was ready, I deployed it using multiple industry-standard approaches.

Deployment targets: Local bare-metal · Docker Compose · AWS EC2 · EKS (Kubernetes) · Terraform-provisioned infrastructure.

Also covered: monitoring, observability, scaling strategies, and system reliability.

👉 **Platform repository:** [Platform Engineering Systems](https://github.com/ibtisam-iq/platform-engineering-systems/tree/main/systems/node-monolith)

---

## Repository Role in the Larger System

```
node-monolith-app  ←  Single source of truth (codebase only)
        │
        ├── git submodule → DevSecOps Pipelines            (CI/CD)
        └── git submodule → Platform Engineering Systems   (Deployment)
```

This repository holds only the application code. All DevOps work — pipelines, deployment configs, and infrastructure — lives in the downstream repositories and references this one via Git submodules.

---

## Key Idea

> Code = Input. Everything else is built around it.

The goal is not to showcase application development. The goal is to demonstrate how **any application** can be taken as input and transformed into a production-like system using DevSecOps and platform engineering practices.
