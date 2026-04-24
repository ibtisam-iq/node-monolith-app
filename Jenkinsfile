// ============================================================
// DevSecOps CI Pipeline — Node.js 3-Tier App
// Tool: Jenkins Declarative Pipeline
// Stack: Node.js 22 LTS · React 18 · Webpack 5 · Babel 7 · Express 4 · MySQL 8.4
//        Nginx (Alpine) · SonarQube · Trivy · Nexus · Docker Hub · GHCR
// Credentials: sonarqube-token · github-creds · docker-creds
//              nexus-creds · ghcr-creds
// SonarQube server: sonar-server  |  Scanner: sonar-scanner
//
// ── REQUIRED JENKINS PLUGINS ──────────────────────────────────────────────────
//   - SonarQube Scanner Plugin    → provides withSonarQubeEnv()
//   - AnsiColor Plugin            → provides ansiColor() option
//   - Coverage Plugin             → provides recordCoverage() DSL
//   - JUnit Plugin                → provides junit() DSL for Jest XML reports
//
// ── NODE.JS TOOLCHAIN NOTE ────────────────────────────────────────────────────
// Node.js 22, npm, trivy, and docker are installed system-wide on the
// Jenkins OS and are available on OS PATH.
//   node -v  → v22.x  (verified on jenkins-server)
//   npm  -v  → resolves automatically with node
// sonar-scanner is NOT installed system-wide — it is registered in
// Manage Jenkins → Tools → SonarQube Scanner as 'sonar-scanner'.
// SCANNER_HOME = tool 'sonar-scanner' resolves its install path at runtime.
//
// ── APP STRUCTURE ─────────────────────────────────────────────────────────────
// Two separate Dockerfiles — both require repo root as build context:
//   Dockerfile.client → Stage 1: node:22-alpine Webpack build
//                     → Stage 2: nginx:alpine runtime (serves static + proxies /api/)
//   Dockerfile.server → Stage 1: node:22-alpine deps (--omit=dev)
//                     → Stage 2: node:22-alpine runtime (non-root appuser)
//
// Two independent package.json files — NO workspace root:
//   client/package.json → React 18 + axios 1.7 + Webpack 5 + Babel 7 (devDeps needed at build)
//   server/package.json → express 4 + mysql2 + cors + dotenv (prod only)
//
// Key differences from 2-tier:
//   - TWO Docker images produced per run (client + server)
//   - client: nginx:alpine (~20 MB) not node:alpine (~180 MB)
//   - server: non-root user (appuser) enforced in Dockerfile.server
//   - Webpack output: client/public/ (bundle.js + index.html + style.css)
//   - nginx/docker.conf: proxy_pass → http://server:5000/api/ (Compose DNS)
//   - React 18 (not 17), axios ^1.7.9 (no SSRF CVE unlike 2-tier ^0.21.1)
//
// ── VERSIONING STRATEGY ───────────────────────────────────────────────────────
// BOTH images carry the SAME tag: <version>-<short-git-sha>-<build-number>
//   e.g.  1.0.0-ab3f12c-42
//
// Same tag is REQUIRED — ArgoCD matches client + server images as a pair.
// If tags differ, ArgoCD cannot guarantee atomic deployment of matched images.
// Version source: server/package.json (server IS the deployable version source).
//
// ── WHY ONE JENKINSFILE (NOT TWO) ─────────────────────────────────────────────
// See docs/migration/07-ci-pipeline-design-decisions.md for full rationale.
// Short answer: same repo + shared build context + shared versioning +
//               atomic CD manifest update → one Jenkinsfile is the only
//               correct choice.
//
// ── STAGE MAP ─────────────────────────────────────────────────────────────────
//  1  → Checkout
//  2  → Trivy FS Scan          (pre-build, 2-pass: CRITICAL exit1 + HIGH/MED advisory)
//  3  → Versioning             (server/package.json + git SHA + build number)
//  4  → Install Dependencies   (client npm install + server npm install --omit=dev, parallel)
//  5  → Build Client           (Webpack 5 → client/public/ — required before Docker build)
//  6  → npm audit              (client + server, 2-pass per package)
//  7  → ESLint SAST — Server   (eslint-plugin-security, enforced errors)
//  8  → ESLint SAST — Client   (+ eslint-plugin-react, react-hooks, XSS rules)
//  9  → Build & Test           (Jest --ci --coverage --passWithNoTests)
// 10  → SonarQube Analysis     (sonar-scanner CLI, client/src + server as sources)
// 11  → Quality Gate           (waitForQualityGate, 5 min timeout, abortPipeline)
// 12  → Docker Build — Client  (Dockerfile.client → nginx:alpine image)
// 13  → Docker Build — Server  (Dockerfile.server → node:alpine non-root image)
// 14  → Trivy Image Scan — Client  (3-pass: OS advisory + lib CRITICAL exit1 + full JSON)
// 15  → Trivy Image Scan — Server  (3-pass: OS advisory + lib CRITICAL exit1 + full JSON)
// 16  → Push Client            (Docker Hub + GHCR + Nexus — main branch only)
// 17  → Push Server            (Docker Hub + GHCR + Nexus — main branch only)
// 18  → Update CD Manifest     (writes CLIENT_IMAGE_TAG + SERVER_IMAGE_TAG atomically)
// post → Cleanup + Notifications  (12 image tags pruned: client+server × 3 registries × 2 tags)
// ============================================================

pipeline {

    // Restrict to Linux agents — sh/trivy/docker all require Linux.
    agent { label 'built-in || linux' }

    environment {
        // ── App metadata
        APP_NAME = 'node-monolith-3tier'

        // ── Image base names — one per tier
        // Full tags constructed at runtime: <IMAGE_NAME>:${IMAGE_TAG}
        CLIENT_IMAGE_NAME = 'mibtisam/node-3tier-client'
        SERVER_IMAGE_NAME = 'mibtisam/node-3tier-server'

        // ── GitHub Container Registry
        GHCR_USER         = 'ibtisam-iq'
        GHCR_CLIENT_IMAGE = "ghcr.io/${GHCR_USER}/node-3tier-client"
        GHCR_SERVER_IMAGE = "ghcr.io/${GHCR_USER}/node-3tier-server"

        // ── Nexus Docker Registry — path-based routing
        // Image format: nexus.ibtisam-iq.com/docker-hosted/<image-name>:<tag>
        NEXUS_URL         = 'https://nexus.ibtisam-iq.com'
        NEXUS_DOCKER      = 'nexus.ibtisam-iq.com'
        NEXUS_DOCKER_REPO = 'docker-hosted'

        // ── AWS ECR  [uncomment once ECR repos are provisioned]
        // AWS_REGION     = 'us-east-1'
        // AWS_ACCOUNT_ID = '123456789012'
        // ECR_REGISTRY   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        // ECR_CLIENT     = "${ECR_REGISTRY}/node-3tier-client"
        // ECR_SERVER     = "${ECR_REGISTRY}/node-3tier-server"

        // ── Source directory
        // APP_DIR = '.' — Jenkinsfile lives at repo root.
        // Both Dockerfiles require repo root as build context.
        APP_DIR = '.'

        // ── Application ports
        SERVER_PORT = '5000'   // Express API (matches Dockerfile.server ARG PORT)
        CLIENT_PORT = '80'     // Nginx (matches Dockerfile.client EXPOSE)

        // ── CD GitOps repo coordinates
        CD_REPO          = 'ibtisam-iq/platform-engineering-systems'
        CD_MANIFEST_PATH = 'systems/node-monolith/3tier/image.env'

        // ── Trivy DB cache — reused across all scan stages
        TRIVY_CACHE_DIR = '/var/cache/trivy'

        // ── sonar-scanner registered in Jenkins Tools (not OS PATH)
        SCANNER_HOME = tool 'sonar-scanner'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10', artifactNumToKeepStr: '5'))
        timeout(time: 75, unit: 'MINUTES')   // 75 min: two Docker builds + two image scans
        disableConcurrentBuilds(abortPrevious: true)
        timestamps()
        ansiColor('xterm')
    }

    stages {

        // ────────────────────────────────────────────────────────────────────
        // STAGE 1 — Checkout
        //
        // checkout scm uses Jenkins-injected SCM object from job config.
        // Guarantees GIT_COMMIT and GIT_BRANCH match the triggering commit.
        // ────────────────────────────────────────────────────────────────────
        stage('Checkout') {
            steps {
                echo '📥 Checking out source...'
                checkout scm
                echo "✅ Branch: ${env.GIT_BRANCH} @ ${env.GIT_COMMIT?.take(7)}"
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 2 — Trivy Filesystem Scan
        //
        // Scans source tree BEFORE any install — fail-fast on declared CVEs.
        // Targets:
        //   client/package.json + server/package.json (npm CVEs)
        //   Dockerfile.client + Dockerfile.server (misconfiguration)
        //   nginx/docker.conf (misconfig)
        //   source files (hardcoded secrets)
        //
        // Two-pass strategy:
        //   Pass 1 — CRITICAL only, --exit-code 1 → FAILS build on finding
        //   Pass 2 — HIGH,MEDIUM only, --exit-code 0 → advisory table only
        //
        // LOW excluded from FS scan (noise). LOW IS included in image scan.
        // --skip-dirs .git: avoids false-positive secrets in git pack files.
        // ────────────────────────────────────────────────────────────────────
        stage('Trivy Filesystem Scan') {
            steps {
                dir(APP_DIR) {
                    echo '🔎 Running Trivy filesystem scan on source tree...'
                    sh """
                        mkdir -p ${TRIVY_CACHE_DIR}

                        echo "=== Pass 1: CRITICAL (enforced — exit 1 on finding) ==="
                        trivy fs \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --skip-dirs .git \\
                            --scanners secret,vuln,misconfig \\
                            --exit-code 1 \\
                            --severity CRITICAL \\
                            --no-progress \\
                            --format json \\
                            --output trivy-fs-critical.json \\
                            .

                        echo "=== Pass 2: HIGH,MEDIUM (advisory — exit 0) ==="
                        trivy fs \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --skip-dirs .git \\
                            --scanners secret,vuln,misconfig \\
                            --exit-code 0 \\
                            --severity HIGH,MEDIUM \\
                            --no-progress \\
                            --format table \\
                            .
                    """
                    archiveArtifacts artifacts: 'trivy-fs-critical.json', allowEmptyArchive: true
                }
            }
            post {
                failure {
                    echo '❌ Trivy FS: CRITICAL vulnerabilities found — review trivy-fs-critical.json'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 3 — Versioning
        //
        // Builds a unique, traceable image tag shared by BOTH images:
        //   <version>-<short-git-sha>-<build-number>   e.g. 1.0.0-ab3f12c-42
        //
        // BOTH client and server images carry the SAME tag — this is required
        // for ArgoCD to deploy them as a matched pair atomically.
        //
        // VERSION SOURCE — server/package.json:
        //   node -p "require('./server/package.json').version"
        //   The server is the deployable unit; client version follows server.
        //
        // --short=7: pins SHA to exactly 7 chars — without explicit length,
        //   git auto-abbreviation grows as repo accumulates commits.
        // ────────────────────────────────────────────────────────────────────
        stage('Versioning') {
            steps {
                dir(APP_DIR) {
                    script {
                        def appVersion = ''

                        if (fileExists('server/package.json')) {
                            appVersion = sh(
                                script: "node -p \"require('./server/package.json').version\"",
                                returnStdout: true
                            ).trim()
                        }

                        if (!appVersion || appVersion.isEmpty()) {
                            error("❌ Could not read version from server/package.json. " +
                                  "Ensure server/package.json exists and contains a valid \"version\" field.")
                        }

                        def shortSha       = sh(script: 'git -C ${WORKSPACE} rev-parse --short=7 HEAD', returnStdout: true).trim()
                        env.IMAGE_TAG      = "${appVersion}-${shortSha}-${BUILD_NUMBER}"
                        env.APP_VERSION    = appVersion
                        env.GIT_SHORT_SHA  = shortSha

                        echo """
╔══════════════════════════════════════════════════════════╗
║  App:          ${APP_NAME}
║  Version:      ${env.APP_VERSION}
║  SHA:          ${env.GIT_SHORT_SHA}
║  Tag (shared): ${env.IMAGE_TAG}
║  Branch:       ${env.GIT_BRANCH}
║  Build:        #${BUILD_NUMBER}
║
║  Client image: ${CLIENT_IMAGE_NAME}:${env.IMAGE_TAG}
║  Server image: ${SERVER_IMAGE_NAME}:${env.IMAGE_TAG}
╚══════════════════════════════════════════════════════════╝
"""
                    }
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 4 — Install Dependencies (Parallel)
        //
        // Two independent package.json files — no workspace root manifest.
        //
        // Client: full install (devDeps required for Webpack 5 + Babel 7)
        //   react 18, axios 1.7, webpack 5, babel-loader, css-loader,
        //   html-webpack-plugin, mini-css-extract-plugin
        //
        // Server: production-only (--omit=dev) — matches Dockerfile.server Stage 1
        //   express, mysql2, cors, dotenv
        //
        // --prefer-offline: uses npm cache on hit, falls back to registry.
        // ────────────────────────────────────────────────────────────────────
        stage('Install Dependencies') {
            parallel {

                stage('Client — npm install') {
                    steps {
                        dir('client') {
                            echo '📦 Installing client dependencies (devDeps included for Webpack/Babel)...'
                            sh '''
                                npm install --prefer-offline
                                echo "✅ Client deps: $(npm list --depth=0 2>/dev/null | wc -l) packages"
                            '''
                        }
                    }
                }

                stage('Server — npm install (prod)') {
                    steps {
                        dir('server') {
                            echo '📦 Installing server dependencies (--omit=dev)...'
                            sh '''
                                npm install --prefer-offline --omit=dev
                                echo "✅ Server deps: $(npm list --depth=0 --omit=dev 2>/dev/null | wc -l) packages"
                            '''
                        }
                    }
                }

            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 5 — Build Client (Webpack)
        //
        // Compiles React 18 frontend with Webpack 5 in production mode.
        // Output: client/public/bundle.js + index.html + style.css
        //
        // webpack.config.js key facts:
        //   entry:   ./src/index.js
        //   output:  client/public/  (clean: true — wipes public/ before each build)
        //   plugins: HtmlWebpackPlugin (template: src/index.html → public/index.html)
        //            MiniCssExtractPlugin (→ public/style.css)
        //   assets:  Webpack 5 native Asset Modules (no file-loader/url-loader)
        //            Files <8KB inlined as base64; larger files emitted separately
        //
        // This stage MUST complete before Stage 12 (Docker Build — Client)
        // because Dockerfile.client Stage 1 runs `npm run build` inside the container.
        // However, we also run it here to:
        //   (a) fail fast on Webpack errors before reaching Docker build
        //   (b) archive the bundle as a build artifact for inspection
        //
        // NODE_ENV=production: activates React production mode + minification.
        // ────────────────────────────────────────────────────────────────────
        stage('Build Client') {
            steps {
                dir(APP_DIR) {
                    echo '🔨 Compiling React 18 frontend with Webpack 5 (production mode)...'
                    sh """
                        cd client
                        NODE_ENV=production npm run build
                        echo "✅ Webpack build complete — output:"
                        ls -lh public/
                        echo "--- bundle.js size ---"
                        du -sh public/bundle.js 2>/dev/null || echo "(bundle.js not found)"
                    """
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'client/public/**', allowEmptyArchive: true
                }
                failure {
                    echo '❌ Webpack build failed — check client/webpack.config.js, src/index.js, and Babel config'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 6 — npm audit (Dependency CVE Scan)
        //
        // WHY npm audit IN ADDITION TO TRIVY FS (Stage 2):
        //   Trivy scans package.json (declared versions).
        //   npm audit scans package-lock.json (fully resolved transitive tree).
        //   Defense in depth — two advisory sources.
        //
        // Two-pass strategy per package (client + server):
        //   Pass A — CRITICAL only, --audit-level=critical, exit 1 → FAILS build
        //   Pass B — HIGH+MEDIUM, --audit-level=high, exit 0 → advisory only
        //
        // 3-tier improvement over 2-tier:
        //   axios upgraded from ^0.21.1 to ^1.7.9 in client/package.json.
        //   The SSRF CVE (axios <0.21.1) that appeared in 2-tier audit is FIXED here.
        //   npm audit should be clean for client.
        //
        // Server audit uses --omit=dev: only prod deps ship to production.
        // ────────────────────────────────────────────────────────────────────
        stage('npm audit') {
            steps {
                dir(APP_DIR) {
                    echo '🔐 Running npm audit on client and server...'
                    sh """
                        echo "── Client audit ──"
                        cd client

                        # Pass A — CRITICAL: fail build
                        npm audit --audit-level=critical --json > ../npm-audit-client.json 2>&1 || {
                            echo '❌ npm audit found CRITICAL vulnerabilities in client.'
                            cat ../npm-audit-client.json
                            exit 1
                        }

                        # Pass B — HIGH+MEDIUM: advisory only
                        npm audit --audit-level=high || true

                        cd ..
                        echo "── Server audit ──"
                        cd server

                        # Pass A — CRITICAL: fail build
                        npm audit --omit=dev --audit-level=critical --json > ../npm-audit-server.json 2>&1 || {
                            echo '❌ npm audit found CRITICAL vulnerabilities in server.'
                            cat ../npm-audit-server.json
                            exit 1
                        }

                        # Pass B — HIGH+MEDIUM: advisory only
                        npm audit --omit=dev --audit-level=high || true

                        cd ..
                        echo '✅ npm audit complete'
                    """
                    archiveArtifacts artifacts: 'npm-audit-client.json,npm-audit-server.json', allowEmptyArchive: true
                }
            }
            post {
                failure {
                    echo '❌ npm audit: CRITICAL CVEs found — see archived JSON reports.'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 7 — ESLint SAST — Server
        //
        // ESLint + eslint-plugin-security — JS SAST for the Express API.
        // Flat config (eslint.config.mjs) — ESLint v9+ format.
        //
        // OWASP-aligned rules:
        //   detect-child-process, detect-unsafe-regex,
        //   detect-non-literal-fs-filename, detect-object-injection
        //
        // SARIF output → archivable audit trail.
        // Enforced: exits 1 if any ERROR-level rule fires.
        // Temp config cleaned in post{} always{}.
        // ────────────────────────────────────────────────────────────────────
        stage('ESLint SAST — Server') {
            steps {
                dir('server') {
                    echo '🔍 Running ESLint SAST on server (Node.js/Express)...'
                    sh '''
                        echo "=== Installing ESLint + security plugin (CI-only) ==="
                        npm install --save-dev \
                            eslint@^9 \
                            eslint-plugin-security@^3 \
                            @microsoft/eslint-formatter-sarif@^3 \
                            2>/dev/null

                        echo "=== Writing ESLint flat config ==="
                        cat > eslint.config.mjs << 'ESLINT_EOF'
import security from 'eslint-plugin-security';

export default [
  {
    files: ['**/*.js'],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      'no-eval':                                        'error',
      'no-implied-eval':                                'error',
      'no-new-func':                                    'error',
      'no-console':                                     'off',
      'no-process-exit':                                'off',
      'security/detect-non-literal-fs-filename':        'warn',
      'security/detect-child-process':                  'error',
      'security/detect-unsafe-regex':                   'error',
      'security/detect-object-injection':               'warn',
      'security/detect-possible-timing-attacks':        'warn',
    },
  },
];
ESLINT_EOF

                        echo "=== ESLint — SARIF output ==="
                        npx eslint \
                            --format @microsoft/eslint-formatter-sarif \
                            --output-file ../eslint-server.sarif \
                            . || true

                        echo "=== ESLint — Human-readable (advisory) ==="
                        npx eslint --format stylish . 2>&1 | tee ../eslint-server.txt || true

                        echo "=== ESLint — Enforced (exits 1 if any error fires) ==="
                        npx eslint --format stylish --max-warnings=0 . 2>&1 | tee -a ../eslint-server.txt
                    '''
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'eslint-server.sarif,eslint-server.txt', allowEmptyArchive: true
                    sh 'rm -f server/eslint.config.mjs || true'
                }
                failure {
                    echo '❌ ESLint SAST (server): ERROR-level rules fired — review eslint-server.txt'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 8 — ESLint SAST — Client
        //
        // Extends server SAST config with React 18-specific rules:
        //   eslint-plugin-react     → JSX rules, dangerouslySetInnerHTML guard
        //   eslint-plugin-react-hooks → hooks exhaustive-deps
        //
        // react/no-danger: 'error' — prevents XSS via raw HTML injection.
        // react/jsx-no-script-url: 'error' — prevents javascript: href XSS.
        //
        // Client node_modules already installed (Stage 4) — adds devDeps only.
        // ────────────────────────────────────────────────────────────────────
        stage('ESLint SAST — Client') {
            steps {
                dir('client') {
                    echo '🔍 Running ESLint SAST on client (React 18)...'
                    sh '''
                        echo "=== Installing ESLint + React + security plugins (CI-only) ==="
                        npm install --save-dev \
                            eslint@^9 \
                            eslint-plugin-security@^3 \
                            eslint-plugin-react@^7 \
                            eslint-plugin-react-hooks@^5 \
                            @microsoft/eslint-formatter-sarif@^3 \
                            @babel/eslint-parser@^7 \
                            2>/dev/null

                        echo "=== Writing ESLint flat config for client ==="
                        cat > eslint.config.mjs << 'ESLINT_EOF'
import security   from 'eslint-plugin-security';
import react      from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import babelParser from '@babel/eslint-parser';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { security, react, 'react-hooks': reactHooks },
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-react'],
        },
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...security.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-eval':                          'error',
      'no-implied-eval':                  'error',
      'react/no-danger':                  'error',
      'react/jsx-no-script-url':          'error',
      'security/detect-unsafe-regex':     'error',
      'react/prop-types':                 'warn',
    },
  },
];
ESLINT_EOF

                        echo "=== ESLint — SARIF output ==="
                        npx eslint \
                            --format @microsoft/eslint-formatter-sarif \
                            --output-file ../eslint-client.sarif \
                            src/ || true

                        echo "=== ESLint — Human-readable ==="
                        npx eslint --format stylish src/ 2>&1 | tee ../eslint-client.txt || true

                        echo "=== ESLint — Enforced ==="
                        npx eslint \
                            --format stylish \
                            src/
                    '''
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'eslint-client.sarif,eslint-client.txt', allowEmptyArchive: true
                    sh 'rm -f client/eslint.config.mjs || true'
                }
                failure {
                    echo '❌ ESLint SAST (client): ERROR-level rules fired — review eslint-client.txt'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 9 — Build & Test (Jest)
        //
        // Covers server (Express route/unit tests with supertest).
        // DB calls mocked via jest.mock(). CI_TEST=true skips real MySQL
        // connection at startup — no DB container needed in CI.
        //
        // JEST FLAGS:
        //   --ci           → fail on new snapshots, disable interactive mode
        //   --coverage     → LCOV + Cobertura XML coverage reports
        //   --forceExit    → prevents Jest hanging on open DB pool handles
        //   --runInBand    → serial execution (avoids port conflicts on CI)
        //   --passWithNoTests → passes when no test files exist yet
        //
        // Coverage written to:
        //   coverage/lcov.info              → SonarQube ingestion (Stage 10)
        //   coverage/cobertura-coverage.xml → Jenkins recordCoverage()
        //
        // junit() + recordCoverage() publishers are in post{} always{} of the
        // outer post block (guarded by fileExists) to avoid duplicate publishing.
        // ────────────────────────────────────────────────────────────────────
        stage('Build & Test') {
            steps {
                dir(APP_DIR) {
                    echo '🧪 Running Jest tests with coverage (server)...'
                    sh """
                        cd server
                        npm install --save-dev \
                            jest@^29 \
                            supertest@^7 \
                            jest-junit@^16 \
                            2>/dev/null

                        cat > jest.config.js << 'JEST_EOF'
module.exports = {
  testEnvironment: 'node',
  coverageReporters: ['text', 'lcov', 'cobertura'],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!node_modules/**',
    '!jest.config.js',
    '!eslint.config.mjs',
  ],
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: '..',
      outputName: 'jest-results.xml',
      classNameTemplate: '{classname}',
      titleTemplate:     '{title}',
    }],
  ],
};
JEST_EOF

                        cd ..

                        CI_TEST=true npx --prefix server jest \
                            --ci \
                            --coverage \
                            --forceExit \
                            --runInBand \
                            --passWithNoTests \
                            2>&1 | tee jest-output.txt
                    """
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'jest-results.xml,jest-output.txt,coverage/**', allowEmptyArchive: true
                    sh 'rm -f server/jest.config.js || true'
                }
                failure {
                    echo '❌ Jest tests failed — review jest-output.txt and jest-results.xml'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 10 — SonarQube Analysis
        //
        // sonar-scanner CLI (registered in Jenkins Tools as 'sonar-scanner').
        //
        // KEY PROPERTIES for 3-tier:
        //   sonar.sources=client/src,server  — both tiers analysed together
        //   sonar.tests=client/src,server    — Jest tests co-located with src
        //   sonar.javascript.lcov.reportPaths → LCOV from Jest (Stage 9)
        //   sonar.exclusions:
        //     - node_modules (both client and server)
        //     - client/public/ (compiled Webpack output — not source)
        //     - nginx/ (no JS to analyse)
        //     - coverage/ (generated reports)
        //
        // SONAR_HOST_URL and SONAR_AUTH_TOKEN injected by withSonarQubeEnv().
        // ────────────────────────────────────────────────────────────────────
        stage('SonarQube Analysis') {
            steps {
                dir(APP_DIR) {
                    echo '📊 Running SonarQube static analysis (both tiers)...'
                    withSonarQubeEnv('sonar-server') {
                        sh """
                            \$SCANNER_HOME/bin/sonar-scanner \\
                                -Dsonar.projectKey=${APP_NAME} \\
                                -Dsonar.projectName="${APP_NAME}" \\
                                -Dsonar.projectVersion=${IMAGE_TAG} \\
                                -Dsonar.sources=client/src,server \\
                                -Dsonar.tests=client/src,server \\
                                -Dsonar.test.inclusions="**/*.test.js,**/*.spec.js" \\
                                -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info \\
                                -Dsonar.junit.reportPaths=jest-results.xml \\
                                -Dsonar.exclusions="**/node_modules/**,client/public/**,nginx/**,coverage/**,**/*.min.js,**/jest.config.js,**/eslint.config.mjs,**/webpack.config.js" \\
                                -Dsonar.sourceEncoding=UTF-8 \\
                                -Dsonar.working.directory=${WORKSPACE}/.scannerwork
                        """
                    }
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 11 — Quality Gate
        //
        // Blocks pipeline until SonarQube webhook fires with pass/fail result.
        // abortPipeline: true → build FAILS on gate failure.
        // Single gate for full codebase (both client/ and server/).
        // ────────────────────────────────────────────────────────────────────
        stage('Quality Gate') {
            steps {
                echo '🚦 Waiting for SonarQube Quality Gate (single gate — full codebase)...'
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
            post {
                failure {
                    echo '❌ SonarQube Quality Gate FAILED — fix code smells, coverage, or security hotspots'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 12 — Docker Build — Client
        //
        // Builds the Nginx + React image from Dockerfile.client.
        //
        // Dockerfile.client stages:
        //   Stage 1 (client-build): node:22-alpine
        //     - COPY client/package.json → npm install
        //     - COPY client/ → npm run build (Webpack → client/public/)
        //   Stage 2 (runtime): nginx:alpine
        //     - COPY --from=client-build /app/client/public /usr/share/nginx/html
        //     - COPY nginx/docker.conf /etc/nginx/conf.d/default.conf
        //     - EXPOSE 80
        //
        // Build context: repo root (.)
        //   Required because Dockerfile.client COPYs from:
        //     client/package.json, client/src/, nginx/docker.conf
        //
        // --pull: forces check for newer base image digests (node:22-alpine, nginx:alpine).
        //
        // Tags: Docker Hub + GHCR tagged in one pass (Nexus tagged at push time).
        // ────────────────────────────────────────────────────────────────────
        stage('Docker Build — Client') {
            steps {
                dir(APP_DIR) {
                    echo "🐳 Building client image (nginx:alpine): ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}"
                    sh """
                        docker build --pull \\
                            --file Dockerfile.client \\
                            --build-arg BUILD_DATE=\$(date -u +%Y-%m-%dT%H:%M:%SZ) \\
                            --label "org.opencontainers.image.title=node-3tier-client" \\
                            --label "org.opencontainers.image.version=${IMAGE_TAG}" \\
                            --label "org.opencontainers.image.revision=${GIT_COMMIT}" \\
                            --label "org.opencontainers.image.created=\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
                            --label "org.opencontainers.image.source=https://github.com/ibtisam-iq/node-monolith-3tier-app" \\
                            --label "org.opencontainers.image.description=React 18 + Nginx frontend — Tier 1" \\
                            -t ${CLIENT_IMAGE_NAME}:${IMAGE_TAG} \\
                            -t ${CLIENT_IMAGE_NAME}:latest \\
                            -t ${GHCR_CLIENT_IMAGE}:${IMAGE_TAG} \\
                            -t ${GHCR_CLIENT_IMAGE}:latest \\
                            .

                        echo "=== Client image size ==="
                        docker image inspect ${CLIENT_IMAGE_NAME}:${IMAGE_TAG} \\
                            --format='{{.Size}}' | \\
                            awk '{printf "Client image size: %.1f MB\\n", \$1/1024/1024}'

                        echo "✅ Docker build complete — ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}"
                    """
                }
            }
            post {
                failure {
                    echo '❌ Docker build (client) failed — check Dockerfile.client and nginx/docker.conf'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 13 — Docker Build — Server
        //
        // Builds the Node.js Express API image from Dockerfile.server.
        //
        // Dockerfile.server stages:
        //   Stage 1 (server-deps): node:22-alpine
        //     - COPY server/package.json → npm install --omit=dev
        //   Stage 2 (runtime): node:22-alpine
        //     - addgroup/adduser appuser (non-root hardening)
        //     - COPY --from=server-deps node_modules
        //     - COPY server/ source
        //     - chown → USER appuser
        //     - ARG PORT=5000, ENV PORT, EXPOSE PORT
        //     - ENTRYPOINT ["node", "server/server.js"]
        //
        // Build context: repo root (.)
        //   Required because Dockerfile.server COPYs from server/.
        //
        // WHY STAGE 13 IS NOT PARALLEL WITH STAGE 12:
        //   See docs/migration/07-ci-pipeline-design-decisions.md.
        //   TL;DR: shared Docker daemon + CPU contention on self-hosted agent +
        //   cleaner failure isolation outweigh the ~90s time saving.
        // ────────────────────────────────────────────────────────────────────
        stage('Docker Build — Server') {
            steps {
                dir(APP_DIR) {
                    echo "🐳 Building server image (node:22-alpine, non-root): ${SERVER_IMAGE_NAME}:${IMAGE_TAG}"
                    sh """
                        docker build --pull \\
                            --file Dockerfile.server \\
                            --build-arg PORT=${SERVER_PORT} \\
                            --label "org.opencontainers.image.title=node-3tier-server" \\
                            --label "org.opencontainers.image.version=${IMAGE_TAG}" \\
                            --label "org.opencontainers.image.revision=${GIT_COMMIT}" \\
                            --label "org.opencontainers.image.created=\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
                            --label "org.opencontainers.image.source=https://github.com/ibtisam-iq/node-monolith-3tier-app" \\
                            --label "org.opencontainers.image.description=Node.js Express API — Tier 2" \\
                            -t ${SERVER_IMAGE_NAME}:${IMAGE_TAG} \\
                            -t ${SERVER_IMAGE_NAME}:latest \\
                            -t ${GHCR_SERVER_IMAGE}:${IMAGE_TAG} \\
                            -t ${GHCR_SERVER_IMAGE}:latest \\
                            .

                        echo "=== Server image size ==="
                        docker image inspect ${SERVER_IMAGE_NAME}:${IMAGE_TAG} \\
                            --format='{{.Size}}' | \\
                            awk '{printf "Server image size: %.1f MB\\n", \$1/1024/1024}'

                        echo "✅ Docker build complete — ${SERVER_IMAGE_NAME}:${IMAGE_TAG}"
                    """
                }
            }
            post {
                failure {
                    echo '❌ Docker build (server) failed — check Dockerfile.server and server/ source'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 14 — Trivy Image Scan — Client
        //
        // Scans the nginx:alpine client image BEFORE pushing.
        //
        // Three-pass strategy:
        //   Pass A — OS (Alpine + Nginx): CRITICAL+HIGH, exit 0 → advisory only
        //            Alpine/Nginx OS CVEs are maintainer responsibility.
        //   Pass B — Library (npm in client build stage is discarded; only
        //            nginx binary deps remain): CRITICAL, exit 1 → FAILS
        //   Pass C — Full report (all types + severities incl. LOW): JSON artifact
        //
        // --ignore-unfixed: skip CVEs with no available fix (reduces noise).
        //
        // Client image is nginx:alpine — expect very low library CVE surface
        // (no node_modules in final image, only compiled static files + nginx).
        // ────────────────────────────────────────────────────────────────────
        stage('Trivy Image Scan — Client') {
            steps {
                dir(APP_DIR) {
                    echo "🛡️  Scanning client image: ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}"
                    sh """
                        echo "=== Pass A: OS packages CRITICAL+HIGH (advisory) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --vuln-type os \\
                            --exit-code 0 \\
                            --severity CRITICAL,HIGH \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format table \\
                            ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}

                        echo "=== Pass B: Library CRITICAL (enforced — exit 1 on finding) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --vuln-type library \\
                            --exit-code 1 \\
                            --severity CRITICAL \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format table \\
                            ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}

                        echo "=== Pass B (cont.): Library HIGH,MEDIUM (advisory) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --vuln-type library \\
                            --exit-code 0 \\
                            --severity HIGH,MEDIUM \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format table \\
                            ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}

                        echo "=== Pass C: Full report incl. LOW (archived) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --exit-code 0 \\
                            --severity CRITICAL,HIGH,MEDIUM,LOW \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format json \\
                            --output trivy-client-image-report.json \\
                            ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}

                        echo "✅ Trivy client image scan complete"
                    """
                    archiveArtifacts artifacts: 'trivy-client-image-report.json', allowEmptyArchive: true
                }
            }
            post {
                failure {
                    echo '❌ Trivy: CRITICAL library CVEs found in client image — review trivy-client-image-report.json'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 15 — Trivy Image Scan — Server
        //
        // Scans the node:22-alpine server image BEFORE pushing.
        //
        // Same three-pass strategy as Stage 14.
        //
        // Server image contains node_modules (production deps only: express,
        // mysql2, cors, dotenv) — higher library CVE surface than client image.
        //
        // Pass B CRITICAL exit 1 — fix = bump version in server/package.json.
        // ────────────────────────────────────────────────────────────────────
        stage('Trivy Image Scan — Server') {
            steps {
                dir(APP_DIR) {
                    echo "🛡️  Scanning server image: ${SERVER_IMAGE_NAME}:${IMAGE_TAG}"
                    sh """
                        echo "=== Pass A: OS packages CRITICAL+HIGH (advisory) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --vuln-type os \\
                            --exit-code 0 \\
                            --severity CRITICAL,HIGH \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format table \\
                            ${SERVER_IMAGE_NAME}:${IMAGE_TAG}

                        echo "=== Pass B: Library CRITICAL (enforced — exit 1 on finding) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --vuln-type library \\
                            --exit-code 1 \\
                            --severity CRITICAL \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format table \\
                            ${SERVER_IMAGE_NAME}:${IMAGE_TAG}

                        echo "=== Pass B (cont.): Library HIGH,MEDIUM (advisory) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --vuln-type library \\
                            --exit-code 0 \\
                            --severity HIGH,MEDIUM \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format table \\
                            ${SERVER_IMAGE_NAME}:${IMAGE_TAG}

                        echo "=== Pass C: Full report incl. LOW (archived) ==="
                        trivy image \\
                            --cache-dir ${TRIVY_CACHE_DIR} \\
                            --exit-code 0 \\
                            --severity CRITICAL,HIGH,MEDIUM,LOW \\
                            --ignore-unfixed \\
                            --no-progress \\
                            --format json \\
                            --output trivy-server-image-report.json \\
                            ${SERVER_IMAGE_NAME}:${IMAGE_TAG}

                        echo "✅ Trivy server image scan complete"
                    """
                    archiveArtifacts artifacts: 'trivy-server-image-report.json', allowEmptyArchive: true
                }
            }
            post {
                failure {
                    echo '❌ Trivy: CRITICAL library CVEs found in server image — review trivy-server-image-report.json'
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGES 16–18 — Publish (main branch only)
        //
        // WHY expression{} INSTEAD OF when { branch 'main' }:
        //   branch{} requires Multibranch Pipeline; on standard Pipeline jobs
        //   BRANCH_NAME is never set. GIT_BRANCH is set by checkout scm:
        //   "origin/main" (standard job) or "main" (Multibranch). Regex matches both.
        //
        // WHY NULL GUARD (env.GIT_BRANCH != null):
        //   REST API-triggered builds may not populate GIT_BRANCH.
        //   null ==~ /regex/ throws NPE crashing when{} evaluation.
        // ────────────────────────────────────────────────────────────────────
        stage('Publish') {
            when {
                expression {
                    env.GIT_BRANCH != null &&
                    (env.GIT_BRANCH ==~ /^(origin\/)?main$/)
                }
            }
            stages {

                // ────────────────────────────────────────────────────────────
                // STAGE 16 — Push Client Image
                //
                // Pushes client (Nginx) image to all three registries:
                //   Docker Hub: mibtisam/node-3tier-client:<tag> + :latest
                //   GHCR:       ghcr.io/ibtisam-iq/node-3tier-client:<tag> + :latest
                //   Nexus:      nexus.ibtisam-iq.com/docker-hosted/node-3tier-client:<tag> + :latest
                //
                // docker logout registry-1.docker.io — explicit registry arg prevents
                // wiping ALL credentials from ~/.docker/config.json.
                // ────────────────────────────────────────────────────────────
                stage('Push Client Image') {
                    steps {
                        echo "🚀 Pushing client image: ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}"

                        // Docker Hub
                        withCredentials([usernamePassword(
                            credentialsId: 'docker-creds',
                            usernameVariable: 'DOCKER_USERNAME',
                            passwordVariable: 'DOCKER_PASSWORD'
                        )]) {
                            sh """
                                echo "\${DOCKER_PASSWORD}" | docker login -u "\${DOCKER_USERNAME}" --password-stdin
                                docker push ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}
                                docker push ${CLIENT_IMAGE_NAME}:latest
                                docker logout registry-1.docker.io
                                echo "✅ Docker Hub — client image pushed"
                            """
                        }

                        // GHCR
                        withCredentials([usernamePassword(
                            credentialsId: 'ghcr-creds',
                            usernameVariable: 'GHCR_USERNAME',
                            passwordVariable: 'GHCR_TOKEN'
                        )]) {
                            sh """
                                echo "\${GHCR_TOKEN}" | docker login ghcr.io -u "\${GHCR_USERNAME}" --password-stdin
                                docker push ${GHCR_CLIENT_IMAGE}:${IMAGE_TAG}
                                docker push ${GHCR_CLIENT_IMAGE}:latest
                                docker logout ghcr.io
                                echo "✅ GHCR — client image pushed"
                            """
                        }

                        // Nexus
                        withCredentials([usernamePassword(
                            credentialsId: 'nexus-creds',
                            usernameVariable: 'NEXUS_USER',
                            passwordVariable: 'NEXUS_PASS'
                        )]) {
                            sh """
                                echo "\${NEXUS_PASS}" | docker login ${NEXUS_DOCKER} -u "\${NEXUS_USER}" --password-stdin
                                docker tag ${CLIENT_IMAGE_NAME}:${IMAGE_TAG} ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-client:${IMAGE_TAG}
                                docker tag ${CLIENT_IMAGE_NAME}:latest       ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-client:latest
                                docker push ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-client:${IMAGE_TAG}
                                docker push ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-client:latest
                                docker logout ${NEXUS_DOCKER}
                                echo "✅ Nexus — client image pushed"
                            """
                        }
                    }
                }

                // ────────────────────────────────────────────────────────────
                // STAGE 17 — Push Server Image
                //
                // Pushes server (Node.js Express) image to all three registries.
                // Same tag as client — ArgoCD matches them as a deployment pair.
                // ────────────────────────────────────────────────────────────
                stage('Push Server Image') {
                    steps {
                        echo "🚀 Pushing server image: ${SERVER_IMAGE_NAME}:${IMAGE_TAG}"

                        // Docker Hub
                        withCredentials([usernamePassword(
                            credentialsId: 'docker-creds',
                            usernameVariable: 'DOCKER_USERNAME',
                            passwordVariable: 'DOCKER_PASSWORD'
                        )]) {
                            sh """
                                echo "\${DOCKER_PASSWORD}" | docker login -u "\${DOCKER_USERNAME}" --password-stdin
                                docker push ${SERVER_IMAGE_NAME}:${IMAGE_TAG}
                                docker push ${SERVER_IMAGE_NAME}:latest
                                docker logout registry-1.docker.io
                                echo "✅ Docker Hub — server image pushed"
                            """
                        }

                        // GHCR
                        withCredentials([usernamePassword(
                            credentialsId: 'ghcr-creds',
                            usernameVariable: 'GHCR_USERNAME',
                            passwordVariable: 'GHCR_TOKEN'
                        )]) {
                            sh """
                                echo "\${GHCR_TOKEN}" | docker login ghcr.io -u "\${GHCR_USERNAME}" --password-stdin
                                docker push ${GHCR_SERVER_IMAGE}:${IMAGE_TAG}
                                docker push ${GHCR_SERVER_IMAGE}:latest
                                docker logout ghcr.io
                                echo "✅ GHCR — server image pushed"
                            """
                        }

                        // Nexus
                        withCredentials([usernamePassword(
                            credentialsId: 'nexus-creds',
                            usernameVariable: 'NEXUS_USER',
                            passwordVariable: 'NEXUS_PASS'
                        )]) {
                            sh """
                                echo "\${NEXUS_PASS}" | docker login ${NEXUS_DOCKER} -u "\${NEXUS_USER}" --password-stdin
                                docker tag ${SERVER_IMAGE_NAME}:${IMAGE_TAG} ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-server:${IMAGE_TAG}
                                docker tag ${SERVER_IMAGE_NAME}:latest       ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-server:latest
                                docker push ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-server:${IMAGE_TAG}
                                docker push ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-server:latest
                                docker logout ${NEXUS_DOCKER}
                                echo "✅ Nexus — server image pushed"
                            """
                        }
                    }
                }

                // ────────────────────────────────────────────────────────────
                // STAGE 18 — Update CD Manifest (GitOps handoff)
                //
                // Writes BOTH image tags into platform-engineering-systems
                // in a SINGLE atomic commit so ArgoCD always sees a matched pair.
                //
                // image.env format:
                //   CLIENT_IMAGE_TAG=1.0.0-ab3f12c-42
                //   SERVER_IMAGE_TAG=1.0.0-ab3f12c-42   ← always equal (same pipeline run)
                //   UPDATED_AT=2026-04-24T18:00:00Z
                //   UPDATED_BY=jenkins-build-42
                //   GIT_COMMIT=abc1234...
                //   GIT_BRANCH=main
                //
                // ATOMIC REQUIREMENT: both tags written in one commit.
                //   If two separate pipelines updated this file independently,
                //   ArgoCD could read a file where CLIENT_IMAGE_TAG is build 42
                //   but SERVER_IMAGE_TAG is still build 41 — mismatched deployment.
                //   One Jenkinsfile → one commit → no race condition.
                //
                // All security hardening from 2-tier Stage 17 carried over:
                //   TOKEN OFF ARGV, UNIQUE TMP DIR, GIT DIFF GUARD, HEAD PUSH.
                // ────────────────────────────────────────────────────────────
                stage('Update CD Manifest') {
                    steps {
                        echo '🔄 Updating CD manifest with both image tags (atomic commit)...'
                        withCredentials([usernamePassword(
                            credentialsId: 'github-creds',
                            usernameVariable: 'GIT_USER',
                            passwordVariable: 'GIT_TOKEN'
                        )]) {
                            sh """
                                # IMAGE_TAG GUARD
                                if [ -z "\${IMAGE_TAG}" ]; then
                                    echo '❌ IMAGE_TAG is empty — aborting CD manifest update'
                                    exit 1
                                fi

                                rm -rf _cd_repo_tmp

                                # TOKEN OFF ARGV — clone public URL; token never in argv
                                git clone https://github.com/${CD_REPO}.git _cd_repo_tmp

                                cd _cd_repo_tmp

                                git remote set-url origin ""
                                git remote set-url origin "https://github.com/${CD_REPO}.git"

                                git config --local user.email "jenkins@ibtisam-iq.com"
                                git config --local user.name  "Jenkins CI"

                                mkdir -p "\$(dirname "${CD_MANIFEST_PATH}")"

                                echo "=== Current manifest ==="
                                cat ${CD_MANIFEST_PATH} 2>/dev/null || echo "(file does not exist yet)"

                                echo "=== Writing new manifest (both tags — same value) ==="
                                cat > ${CD_MANIFEST_PATH} << EOF
CLIENT_IMAGE_TAG=\${IMAGE_TAG}
SERVER_IMAGE_TAG=\${IMAGE_TAG}
UPDATED_AT=\$(date -u +%Y-%m-%dT%H:%M:%SZ)
UPDATED_BY=jenkins-build-${BUILD_NUMBER}
GIT_COMMIT=${GIT_COMMIT}
GIT_BRANCH=${GIT_BRANCH}
EOF

                                git add "${CD_MANIFEST_PATH}"

                                git diff --cached --quiet \\
                                    && echo "ℹ️  Nothing to commit — image tag unchanged" \\
                                    || git commit -m "ci: update node-3tier image tags to \${IMAGE_TAG} [skip ci]"

                                # TOKEN OFF ARGV — push via credential helper
                                git -c credential.helper='!f() { printf "username=%s\\n" "\${GIT_USER}"; printf "password=%s\\n" "\${GIT_TOKEN}"; }; f' \\
                                    push origin HEAD

                                git remote set-url origin "https://github.com/${CD_REPO}.git"
                            """
                        }
                    }
                }

            } // end stages (Publish)
        } // end stage('Publish')

    } // end stages

    // ────────────────────────────────────────────────────────────────────────
    // POST — Publishers, Cleanup & Notifications
    //
    // ORDERING (intentional — do not reorder):
    //   1. Jest JUnit XML publisher       — before cleanWs() removes files
    //   2. Coverage publisher             — before cleanWs() removes files
    //   3. Docker cleanup — 12 image tags:
    //        client × (Docker Hub + GHCR + Nexus) × (versioned + latest) = 6
    //        server × (Docker Hub + GHCR + Nexus) × (versioned + latest) = 6
    //   4. CD tmp dir cleanup
    //   5. cleanWs() — always last
    //
    // FILEEXISTS GUARDS:
    //   If the pipeline fails before Stage 9 (Build & Test), jest-results.xml
    //   and coverage/ do not exist. Guards prevent publisher failures from
    //   polluting the post block exit code.
    // ────────────────────────────────────────────────────────────────────────
    post {
        always {
            // ── 1. Jest JUnit XML publisher
            script {
                if (fileExists("${APP_DIR}/jest-results.xml")) {
                    junit testResults: "${APP_DIR}/jest-results.xml",
                          allowEmptyResults: true
                } else {
                    echo '⏭️  Skipping junit — jest-results.xml not found (pipeline failed before Build & Test stage).'
                }
            }

            // ── 2. Coverage publisher (Coverage Plugin — COBERTURA parser)
            script {
                if (fileExists("${APP_DIR}/coverage/cobertura-coverage.xml")) {
                    recordCoverage(
                        tools: [[
                            parser:  'COBERTURA',
                            pattern: "${APP_DIR}/coverage/cobertura-coverage.xml"
                        ]],
                        sourceCodeRetention: 'EVERY_BUILD'
                    )
                } else {
                    echo '⏭️  Skipping recordCoverage — cobertura-coverage.xml not found (pipeline failed before Build & Test stage).'
                }
            }

            // ── 3. Docker cleanup — all 12 image tags
            script {
                if (env.IMAGE_TAG) {
                    echo '🧹 Cleaning up local Docker images (client + server, all registries)...'
                    sh """
                        # Client — Docker Hub
                        docker rmi ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}                                            || true
                        docker rmi ${CLIENT_IMAGE_NAME}:latest                                                  || true

                        # Client — GHCR
                        docker rmi ${GHCR_CLIENT_IMAGE}:${IMAGE_TAG}                                           || true
                        docker rmi ${GHCR_CLIENT_IMAGE}:latest                                                 || true

                        # Client — Nexus
                        docker rmi ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-client:${IMAGE_TAG}         || true
                        docker rmi ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-client:latest               || true

                        # Server — Docker Hub
                        docker rmi ${SERVER_IMAGE_NAME}:${IMAGE_TAG}                                           || true
                        docker rmi ${SERVER_IMAGE_NAME}:latest                                                 || true

                        # Server — GHCR
                        docker rmi ${GHCR_SERVER_IMAGE}:${IMAGE_TAG}                                           || true
                        docker rmi ${GHCR_SERVER_IMAGE}:latest                                                 || true

                        # Server — Nexus
                        docker rmi ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-server:${IMAGE_TAG}         || true
                        docker rmi ${NEXUS_DOCKER}/${NEXUS_DOCKER_REPO}/node-3tier-server:latest               || true

                        # Prune dangling layers
                        docker image prune -f || true
                    """
                } else {
                    echo '⏭️  Skipping docker rmi — IMAGE_TAG not set (pipeline failed before Versioning stage).'
                    sh 'docker image prune -f || true'
                }
            }

            // ── 4. CD tmp dir cleanup
            sh 'rm -rf _cd_repo_tmp || true'

            // ── 5. Workspace cleanup — always last
            cleanWs()
        }

        success {
            script {
                def published = (env.GIT_BRANCH != null && env.GIT_BRANCH ==~ /^(origin\/)?main$/)
                    ? 'PUBLISHED to all registries ✅'
                    : 'NOT PUBLISHED — non-main branch (build + scan only)'
                echo """
╔══════════════════════════════════════════════════════════════╗
║  ✅  PIPELINE SUCCEEDED
╠══════════════════════════════════════════════════════════════╣
║  Branch  : ${env.GIT_BRANCH}
║  Status  : ${published}
║  Tag     : ${IMAGE_TAG}
║
║  Client  : ${CLIENT_IMAGE_NAME}:${IMAGE_TAG}
║  GHCR-C  : ${GHCR_CLIENT_IMAGE}:${IMAGE_TAG}
║
║  Server  : ${SERVER_IMAGE_NAME}:${IMAGE_TAG}
║  GHCR-S  : ${GHCR_SERVER_IMAGE}:${IMAGE_TAG}
║
║  Nexus   : ${NEXUS_URL}
╚══════════════════════════════════════════════════════════════╝
                """
            }
        }

        failure {
            echo """
╔══════════════════════════════════════════════════════════════╗
║  ❌  PIPELINE FAILED                                         ║
║  Check console output above for the failing stage            ║
╚══════════════════════════════════════════════════════════════╝
            """
        }

        unstable {
            echo '⚠️  Pipeline is UNSTABLE — test failures or quality issues detected.'
        }
    }
}
