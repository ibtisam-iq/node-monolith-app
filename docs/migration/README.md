# Migration Documentation

This folder contains detailed documentation for every architectural change made to this codebase — from the original 2-tier monolith to a properly structured 3-tier application with a modern frontend build pipeline and Nginx-based serving.

## Documents

| File | What It Covers |
|---|---|
| [`01-architecture-theory.md`](./01-architecture-theory.md) | What 2-tier and 3-tier architectures mean, and why the distinction matters |
| [`02-original-problems.md`](./02-original-problems.md) | Audit of the original codebase — every problem found and why it was a problem |
| [`03-migration-changes.md`](./03-migration-changes.md) | Every backend change made during the 2-tier → 3-tier migration, with before/after comparisons |
| [`04-how-to-read-any-codebase.md`](./04-how-to-read-any-codebase.md) | A general methodology for auditing and understanding an unfamiliar codebase |
| [`05-frontend-build-modernization.md`](./05-frontend-build-modernization.md) | Frontend build pipeline refactor — why `public/` files were hand-placed, what was wrong with that, and how webpack now generates everything in `dist/` |
| [`06-frontend-serving-journey.md`](./06-frontend-serving-journey.md) | Step-by-step journal of every attempt to serve the decoupled frontend — from Express static to Python HTTP server to Nginx reverse proxy — with every failure documented |
| [`full-guide.md`](./full-guide.md) | Combined reference — all migration content in a single document |

## Reading Order

If you are new to this project, read in order: `01` → `02` → `03` → `05` → `06`. Documents `04` and `full-guide.md` are supplementary references.
