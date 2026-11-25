# Netlify production deployment

Blog Machine deploys as a Vite frontend plus a **Netlify Server** Express API. Netlify Database stores the workspace in Postgres. The local development workflow continues to use SQLite.

A static upload of `dist/` alone is incomplete: the editor needs the `/api` routes to read and save content.

## Project setup

1. Connect this GitHub repository to the existing Netlify project. Use `main` as the production branch. The repository's `netlify.toml` supplies the build command, publish directory, Node version, and server settings.
2. Set **Project configuration → General → Visitor access → Project visibility → Private** for production and previews. On plans using the older interface, enable **Team login protection → All deploys**. Shared-password protection does not provide the Netlify user identity this app checks.
3. Deploy the production branch. Netlify detects `netlify/server/index.ts` and bundles the Express server. The first migration in `netlify/database/migrations/` provisions Netlify Database and creates the content tables during deployment.
4. Sign in to the private site with the Netlify account allowed to view the project. Confirm that the dashboard loads and a temporary draft survives saving and reloading before using live integrations.

Netlify Server requires a credit-based plan or an eligible Enterprise plan and is currently in Early Access. The configuration uses the small Frankfurt instance with a maximum of one running instance. Netlify's normal database, deployment, and traffic usage charges apply; this repository does not upgrade a plan or purchase credits.

## Access and data

Every API endpoint requires an unexpired user identity from Netlify's signed request context. Client-supplied identity headers do not grant access. If the project is public or the visitor is not signed in, the API returns 401 and does not read or change workspace data. Private project visibility also protects frontend files served directly by Netlify's CDN.

Content tables are prefixed with `blogmachine_`. The database contains posts, website settings, publication records, prepared repository artifacts, and a seed marker. Demo content is seeded once per database. Deploy previews use Netlify's separate database branches. Startup checks and seeding are atomic, and mutating API requests hold a database transaction advisory lock through the entire handler, including remote publishing work and client disconnections.

Netlify's filesystem is temporary and must not hold the production SQLite database. `DATABASE_PATH` still controls SQLite for local `npm run dev` or `npm start`; it is not used by the Netlify entry point. The new hosted database is separate from an existing local workspace. Keep local SQLite backups if you have existing work to migrate; deploying does not upload local `data/` files or credentials.

Credentials belong in Netlify's runtime environment settings. Do not put them in source or frontend build variables. Configure the matching WordPress credential prefix and exact URL, or the Google access token, only when enabling those integrations. A presence indicator does not establish live account access.

Administrator sessions for optional Mediašped connections remain in server memory. Reconnect after deployments, scale-to-zero restarts, or session expiration. The production bundle does not include sibling website checkouts. In Repository connections, import each website’s source snapshot. Validated content and image metadata are stored in the private Postgres workspace and restored into temporary server files after cold starts. The snapshot workflow needs no Git binary or runtime GitHub token. OcenaGor also supports a scoped read-only GitHub token when no checkout or imported snapshot is available; see [the three-domain workflow](ocenagor-family.md). Snapshots remain at their displayed commit until explicitly updated; they do not automatically follow GitHub. Never commit private website snapshots to this public repository. The standalone WordPress, manual-export, and demo workflows do not need those checkouts.

## Validation

```sh
npm ci
npm test
npm run build
```

The default suite runs local SQLite, asynchronous storage, private-access, and publishing tests. Postgres integration tests are explicitly skipped unless an isolated test database URL is supplied:

```sh
TEST_POSTGRES_URL='postgresql://USER:PASSWORD@127.0.0.1:55432/TEST_DATABASE' npm test
```

Use a disposable test database. The tests create and remove isolated schemas. They cover persistence across storage restarts, transactional deletion and rollback, concurrent seeding, advisory locking, prepared artifacts, and migration compatibility. They do not disable TLS verification for hosted connections.

A local `netlify build --offline` cannot provision the managed database. Confirm the actual Netlify build and migration results in the project's deploy log. A successful Vite build alone does not prove that the production API deployed.

For a private site, unauthenticated requests may be redirected to Netlify login before reaching the API. After login, `/api/health` must return `{"status":"ok"}` and `/api/state` must return workspace JSON. Check create, save, reload, and delete with a temporary draft. Demo publishing remains local; do not publish to real websites as a deployment health check.
