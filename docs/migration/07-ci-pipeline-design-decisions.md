# 07 — CI Pipeline Design Decisions

> **Why we write one Jenkinsfile (not two) for the 3-tier app, and how the pipeline is structured**

---

## Context

After migrating this application from 2-tier to 3-tier architecture, the next step was writing the CI/CD pipeline. The 3-tier app now has two separate Dockerfiles:

- `Dockerfile.client` — builds the React frontend, serves it via Nginx
- `Dockerfile.server` — builds the Node.js Express API

This raised an immediate architectural question:

> **Should we write one Jenkinsfile for the entire repo, or two separate Jenkinsfiles — one for the client and one for the server?**

This document records the reasoning behind the decision, the industry standards applied, and the exact pipeline structure chosen.

---

## The Question

| Option | Description |
|---|---|
| **Option A** | One `Jenkinsfile` at the repo root — covers the full lifecycle of both client and server |
| **Option B** | Two files: `Jenkinsfile.client` + `Jenkinsfile.server` — each pipeline owns one image |

---

## When Two Jenkinsfiles Are Correct

Two separate pipeline files are the right choice **only** when ALL of the following are true:

1. **Separate repositories** — client and server live in different Git repos with independent commit histories
2. **Independent release cycles** — client can be released to production without the server changing, and vice versa, with no coordination required
3. **Separate teams** — different squads own the client and server, with different on-call rotations and deployment approvals
4. **Separate artifact lifecycles** — the client image and server image have no shared versioning contract; each is versioned, tagged, and deployed independently

This is the true microservices model. Companies like Netflix, Uber, and Amazon use this pattern — but only because each of their services genuinely satisfies all four conditions above.

---

## Why This Repo Uses One Jenkinsfile

None of the four conditions above apply here. The evidence from the codebase is conclusive:

### 1. Same Repository, Same Branch

`client/` and `server/` both live inside `node-monolith-3tier-app/` on the same `main` branch. A single `git push` touches both. There is no mechanism to push only the client or only the server — a commit to `main` is a commit to the full repo.

If we had two Jenkinsfiles, **both would trigger on every push**. We would pay the cost of two full pipeline runs for every single commit, regardless of what changed.

### 2. Shared Build Context

Both Dockerfiles declare:

```dockerfile
# Build context = node-monolith-3tier-app/ (repo root)
```

`Dockerfile.client` uses:
```dockerfile
COPY client/package.json ./
COPY client/ ./
COPY nginx/docker.conf /etc/nginx/conf.d/default.conf
```

`Dockerfile.server` uses:
```dockerfile
COPY server/package.json ./
COPY server/ ./
```

Both Dockerfiles require the **repo root as their build context**. They are not self-contained. Neither can be built from its own subdirectory in isolation.

### 3. Shared `compose.yml`

The `compose.yml` at the repo root defines all three services (`client`, `server`, `db`) as a single unit. There is no separate compose file for the client and a separate one for the server. They are designed to run together.

### 4. Shared Versioning Contract

Both images must carry the **same version tag** derived from `server/package.json` + git SHA + build number:

```
1.0.0-ab3f12c-42
```

The client image and server image that are deployed together must be tagged identically so the CD system (ArgoCD) can match them. If two separate pipelines ran independently, they would produce different SHA segments and different build numbers — making it impossible to know which client image pairs with which server image in production.

### 5. Shared CD Manifest

The GitOps handoff step (final stage) writes a single `image.env` file to the CD repo:

```env
CLIENT_IMAGE_TAG=1.0.0-ab3f12c-42
SERVER_IMAGE_TAG=1.0.0-ab3f12c-42
UPDATED_AT=2026-04-24T18:00:00Z
UPDATED_BY=jenkins-build-42
GIT_COMMIT=abc1234...
GIT_BRANCH=main
```

Both tags must be committed **atomically in a single commit**. If two separate pipelines updated the manifest independently, there would be a race condition: ArgoCD could read a manifest where `CLIENT_IMAGE_TAG` is from build 42 but `SERVER_IMAGE_TAG` is still from build 41 — deploying a mismatched pair.

### 6. Shared Static Analysis Scope

SonarQube is configured with:

```
sonar.sources=client/src,server
```

Both directories are analysed together as one project. The Quality Gate is a single pass/fail decision for the entire codebase. Splitting into two pipelines would require two separate SonarQube projects, two Quality Gates, and two sets of thresholds — adding complexity with no benefit.

---

## The Decision

**One `Jenkinsfile` at the repo root.**

This is a **monorepo with two build artifacts**. The pipeline owns the full lifecycle of the repository: it builds both images, scans both images, pushes both images, and updates the CD manifest atomically.

This is the same pattern used by companies that ship monorepos to production — the pipeline is single-entry-point, the artifacts are multiple.

---

## How the Pipeline Is Structured

The 2-tier Jenkinsfile had 17 stages and produced **one Docker image**. The 3-tier Jenkinsfile has **18 stages** and produces **two Docker images**.

Stages 1–11 are identical between 2-tier and 3-tier (checkout, scan, install, build, audit, SAST, test, SonarQube, Quality Gate). The divergence begins at Stage 12.

### Full Stage Map

| # | Stage | Notes |
|---|---|---|
| 1 | Checkout | `fetch-depth: 0` for SonarQube blame |
| 2 | Trivy FS Scan | 2-pass advisory (CRITICAL + HIGH/MED) — pre-build |
| 3 | Versioning | Read from `server/package.json` + git SHA + build number |
| 4 | Install Dependencies | `client/` full install + `server/` `--omit=dev`, parallel |
| 5 | Build Client | Webpack 5 → `client/public/` (required before Docker build) |
| 6 | npm audit | 2-pass per package: CRITICAL fail + HIGH/MED advisory |
| 7 | ESLint SAST — Server | `eslint-plugin-security`, enforced errors |
| 8 | ESLint SAST — Client | + `eslint-plugin-react`, `react-hooks`, XSS rules |
| 9 | Build & Test | Jest `--ci --coverage --passWithNoTests` |
| 10 | SonarQube Analysis | `sonar-scanner` CLI, both tiers as sources |
| 11 | Quality Gate | Single gate for full codebase |
| **12** | **Docker Build — Client** | `Dockerfile.client` → `node-3tier-client:<tag>` |
| **13** | **Docker Build — Server** | `Dockerfile.server` → `node-3tier-server:<tag>` |
| **14** | **Trivy Image Scan — Client** | 3-pass: OS advisory + lib CRITICAL fail + full JSON |
| **15** | **Trivy Image Scan — Server** | 3-pass: OS advisory + lib CRITICAL fail + full JSON |
| **16** | **Push Client** | Docker Hub + GHCR + Nexus — `main` branch only |
| **17** | **Push Server** | Docker Hub + GHCR + Nexus — `main` branch only |
| **18** | **Update CD Manifest** | Writes both `CLIENT_IMAGE_TAG` + `SERVER_IMAGE_TAG` atomically |
| post | Cleanup | Prunes all 12 image tags (client + server × 3 registries × versioned + latest) |

### Why Stages 12–13 Are NOT Parallel

Jenkins parallel blocks are used when two tasks are fully independent and we want to save wall-clock time. Stages 12 and 13 could theoretically run in parallel, but they are kept sequential here because:

- Both share the same Docker daemon on the Jenkins agent
- Running two multi-stage builds simultaneously causes CPU and memory contention on a self-hosted agent
- Sequential execution is predictable; a failure in Stage 12 produces a clear, unambiguous error message without interleaved output from Stage 13
- The time saved by parallelism (~90 seconds on this codebase) does not justify the operational complexity on a self-hosted stack

The same reasoning applies to Stages 14–15 (Trivy scans) and Stages 16–17 (pushes).

### Two Image Naming Conventions

| Image | Docker Hub | GHCR | Nexus |
|---|---|---|---|
| Client (Nginx + React) | `mibtisam/node-3tier-client:<tag>` | `ghcr.io/ibtisam-iq/node-3tier-client:<tag>` | `nexus.ibtisam-iq.com/docker-hosted/node-3tier-client:<tag>` |
| Server (Node.js Express) | `mibtisam/node-3tier-server:<tag>` | `ghcr.io/ibtisam-iq/node-3tier-server:<tag>` | `nexus.ibtisam-iq.com/docker-hosted/node-3tier-server:<tag>` |

Both images carry the **same tag** (`<version>-<short-sha>-<build-number>`) because they are built from the same git commit in the same pipeline run.

---

## What This Means for the CD Side

The CD repo (`platform-engineering-systems`) receives a single commit per pipeline run with this manifest:

```env
# systems/node-monolith/3tier/image.env
CLIENT_IMAGE_TAG=1.0.0-ab3f12c-42
SERVER_IMAGE_TAG=1.0.0-ab3f12c-42
UPDATED_AT=2026-04-24T18:00:00Z
UPDATED_BY=jenkins-build-42
GIT_COMMIT=abc1234...
GIT_BRANCH=main
```

ArgoCD watches this file. When it changes, ArgoCD deploys the new client image and the new server image together — always a matched pair, never a mismatched deployment.

This atomic update is only possible because **one pipeline owns both images**. If two separate pipelines each updated the manifest independently, ArgoCD would see two separate commits and could deploy them at different times, creating a window where a new client is talking to an old server.

---

## Summary: The Rule

> **One repo → one Jenkinsfile.**
> **One Jenkinsfile → one versioning source of truth.**
> **One versioning source of truth → atomic CD updates.**
> **Atomic CD updates → no mismatched deployments in production.**

Two Jenkinsfiles are for two repos. This is one repo.
