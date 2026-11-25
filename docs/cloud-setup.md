# Cloud development setup

The local development workflow needs Node.js **24.14.0 or newer** and npm. SQLite is built into Node; no separate database service, `.env` file, or website credentials are required for the editor and demo publishing.

Use the existing checkout at `/workspace/blogmachine`. Each cloud task is already isolated; do not create another Git worktree unless requested. Preserve existing files and check `git status` before setup.

## Install and validate

Run from the application checkout:

```sh
cd /workspace/blogmachine
node --version
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
npm run build
npm test
```

Check that the Node version meets the requirement before installing. `npm ci` uses the committed lockfile; keep dependency declarations and the lockfile unchanged during setup. The explicit cache path avoids writes to a restricted default npm cache.

The build performs TypeScript checking and produces `dist/`. The test suite exercises the API, SQLite persistence, validation, repository adapters, and mocked external integrations. Passing these tests does not verify live website authentication or publishing.

## Start development

```sh
cd /workspace/blogmachine
npm run dev
```

Keep this command running in a persistent execution session. It starts both the Express API on port **3001** and Vite on port **5173**, bound to `0.0.0.0`. Check for existing listeners before starting a second instance. Keep the default API port: Vite's `/api` proxy is configured to target port 3001.

After startup, run these internal checks in another session:

```sh
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:3001/api/health
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:5173/api/health
curl --fail --silent --show-error http://127.0.0.1:5173/
curl --fail --silent --show-error http://127.0.0.1:5173/api/state
```

Both health requests must return `{"status":"ok"}`. The frontend must return the application HTML, and the state endpoint must return the saved sites, posts, and publications. A fresh database seeds three demo sites and three posts; an existing database must retain its data. For a functional smoke check, create and edit a temporary post, publish it only to a site marked **demo**, then delete it. Demo publication creates local records without contacting a website.

These loopback addresses are for internal validation. They are not cloud preview links. The application is a single-user local tool without general authentication; do not expose it publicly without access controls.

## Production startup and retained data

To verify the built application, stop the development processes you started, then run:

```sh
cd /workspace/blogmachine
npm run build
npm start
```

Production serves the built frontend and API together on port 3001. Check `/`, a JavaScript asset referenced by the returned HTML, `/api/health`, and `/api/state` on that port. Development and production cannot share API port 3001 at the same time.

The default database is `data/blogmachine.sqlite`; `DATABASE_PATH` can override it. Preserve the database and its SQLite WAL files. Do not delete data to repeat setup or copy a live database without SQLite backup tools. `node_modules/`, `dist/`, `data/`, and `.env` are ignored by Git. Never commit credentials.

Cloud publication can retain installed dependencies and files, but live processes must restart in a new task. Administrator accounts must reconnect after the server restarts because their sessions live only in server memory. Save the installation commands as the environment's `install_script` and development startup/readiness instructions as its `start_skill`. Review and save those settings, then publish the environment to create a reusable snapshot. A Git commit or saved configuration draft alone does not publish that snapshot or verify restoration in a fresh task.

## Optional website connections

Setting up this repository alone does not install the website checkouts listed in **Repository connections**. Missing website checkouts are expected until those repositories are explicitly added. The catalog has nine entries, including three empty placeholders. Adapters use sibling checkouts under `/workspace` by default; see [Connecting your websites](connecting-websites.md) for required identities and paths.

Live WordPress, Google Search Console, and Supabase workflows require separate network access and credentials. Inspect the actual environment's bindings and allowed domains before configuring them; never assume access from an earlier workspace. Mediašped normally uses **Connect account** with an existing administrator account. Do not use live publication, remote draft insertion, or sitemap submission as setup checks.

## Validation record

On 2026-11-25, local onboarding with Node.js 24.22.3 verified installation, all **111 tests** (no failures or skips), type checking, and the production build. Development and production startup, frontend delivery, the API proxy, draft creation/editing, local demo publication, and SQLite persistence across a service restart also passed. Temporary smoke-test records were removed. Live integrations, cloud snapshot publication, and fresh-task restoration were not validated.
