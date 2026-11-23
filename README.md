# Blog Machine

One workspace for writing posts, publishing to your websites, and checking Google indexing.

A local application with a React/TypeScript dashboard, Express API, and persistent SQLite storage. The **Repository connections** hub covers nine repositories with four Git content adapters, two database profiles, and three empty placeholders. The separate **Websites** flow includes three clearly labeled demo websites so you can try publishing without credentials.

## Run

Requires **Node.js 24.14+** and npm.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. The API runs on port 3001. Keep both processes running; `npm run dev` starts them together. If your machine restricts writes to the default npm cache, add `--cache /workspace/.npm-cache` to `npm ci`.

```sh
npm test        # API, persistence, validation, and mocked integration tests
npm run build   # Type checking and production frontend build
npm start       # Serve the built app and API on port 3001
```

Production mode still runs a **single-user local application**, not an authenticated public service. Do not expose it to the public internet without adding authentication and access controls.

## What works

- Create, edit, search, filter, delete, and export plain-text posts.
- Browse inspected repository content and prepare downloadable Git patches or unpublished database JSON drafts. Preparation saves an artifact in Blog Machine; it does not edit website source, commit, push, deploy, or write to a website database.
- Connect an existing Mediašped administrator account from the hub, then use the separate **Save website draft** action after verification. This inserts an unpublished draft into its existing Supabase editor; it never overwrites an article or publishes it. Live administrator login and a real remote draft save remain unvalidated until you sign in.
- Save drafts in SQLite and publish one post to multiple selected destinations.
- Demo publishing: creates local publication records, without contacting any real website.
- WordPress publishing: sends escaped plain-text content to the official WordPress REST API using an application password. Known successful publications are updated when you republish. If a create request ends with an uncertain outcome, automatic retries are paused to avoid duplicates; check the WordPress site and reconcile that article before publishing again.
- Manual publishing: export `.txt` files from Posts and paste content into any other CMS. Manual destinations cannot publish automatically.
- Google Search Console: inspect actual published URLs and submit a sitemap for a verified property when configured. Demo publications cannot be submitted or inspected.
- Separate per-site publication errors, real versus demo records, and honest indexing status.

## Connect your websites

Use **Repository connections** for the inspected Mediašped, OcenaGor.si, LogisticsWorld, Onlyworld, Lumina, and Trgovina content workflows. Mediašped uses Supabase; OcenaGor.si uses static source files. Their adapters are implemented, while live database access and production deployments are separate prerequisites. Pultaro, Agencija delavci, and Klicni center remain empty placeholders. No per-site MCP server is required.

Save a post with a title, lowercase hyphenated slug, short description, and body before preparing it. The description is optional in the general post editor but required by the repository hub. Use `## Section heading` lines to separate body sections. The hub checks the checkout HEAD and, for Git content, the loaded source hash before preparing a change. Generated source is checked for syntax and schema compatibility; this is not a full build of the destination website.

See [Connecting your websites](docs/connecting-websites.md) for each adapter, required metadata, credentials, and deployment limits. **Websites** remains the separate WordPress, manual export, and demo publishing flow; checking a public website there does not authenticate a repository connector.

## Connect Mediašped

Open **Repository connections → Mediašped → Connect account** and sign in with your existing Mediašped administrator email and password. Blog Machine verifies the account and administrator role; it does not create an account. Review a prepared draft before choosing the separate **Save website draft** action. Publication still happens in the existing Mediašped editor.

Access and refresh tokens stay in server memory, and the browser receives only an opaque HttpOnly session cookie. Passwords and tokens are not saved in SQLite, files, or browser storage. Sessions refresh automatically while usable; reconnect after a server restart, failed refresh, or the eight-hour session limit. **Disconnect** ends the connection for this browser and disables its environment-token fallback. The optional `MEDIASPED_SUPABASE_ACCESS_TOKEN` environment variable is for headless use, not normal account setup.

## Connect WordPress

1. Add your website in **Websites**, select WordPress, and enter its HTTPS address. A WordPress install under a subdirectory is supported.
2. Note its credential prefix, such as `MY_WEBSITE`.
3. Create an application password in WordPress under **Users → Profile → Application Passwords**, using an account allowed to publish posts.
4. Copy `.env.example` to `.env` and set `MY_WEBSITE_URL` to the exact saved website URL (no trailing slash), plus `MY_WEBSITE_USERNAME` and `MY_WEBSITE_APPLICATION_PASSWORD`. The server loads `.env`; credentials are never sent to the browser or saved in SQLite.
5. Restart `npm run dev` and use **Test connection** on the website card. This verifies authentication without creating a post; publishing permission is confirmed only if WordPress returns an explicit capability.
6. When ready, write a post, select the website, and choose **Publish post**. This immediately publishes to the live site.

Live websites must be reachable over HTTPS. The connector blocks local/private URLs and redirects. Direct connections pin a validated public DNS address. Managed proxy connections use the trusted environment proxy and require an exact website URL binding before sending credentials. If WordPress redirects its API, use the final canonical HTTPS site address.

In a managed cloud environment, the network policy must also allow the hostname of your WordPress website. Google integration needs `searchconsole.googleapis.com` and `www.googleapis.com`. The repository database profiles need `ytmowbzkpofeeocgevyr.supabase.co` (Mediašped) and `cybwzhgretztcjfdefoy.supabase.co` (Trgovina). Saving an environment draft does not apply its network policy or publish its snapshot.

## Connect Search Console

Add the website’s exact verified property in its settings: for example `sc-domain:example.com` or `https://example.com/`. Configure `GOOGLE_ACCESS_TOKEN` in `.env`, using a Google OAuth token with property access and the `https://www.googleapis.com/auth/webmasters` scope, then restart the server.

Tokens are short-lived: this starter does not include the Google OAuth consent flow or automatic token refresh. Refresh the token outside the app. Google’s API must be enabled for the project, and quotas apply.

Use **Search & indexing** to inspect published live URLs or submit a sitemap your website already serves. A sitemap is not generated by this app. **Google decides when to crawl and index.** Ordinary blog posts are not eligible for the restricted Google Indexing API; there is no “force index” endpoint here.

## Data and scope

The database lives at `data/blogmachine.sqlite` by default; override with `DATABASE_PATH`. Demo content is seeded once per database. Removing all data in the UI does not reseed it on restart. Back up the SQLite database with SQLite's backup tools, or stop the server before copying its database and WAL files.

Deleting a post or website removes local records only; remote WordPress articles remain published. There is no background scheduler, AI generation, or automatic translation. Git patches require review, destination-site checks, and a separate deployment workflow. Trgovina exports database drafts only; Mediašped remote draft insertion requires the explicit action described above.

Outbound content changes occur only through explicit actions: WordPress **Publish post**, Mediašped **Save website draft**, or sitemap submission. Login, connection tests, and article lists also make network requests, without creating content. Automated authentication and write tests use mocked external services; a live Mediašped public article read succeeded, but no actual authenticated draft write or website deployment has been performed. Sign in securely through **Connect account** to validate the Mediašped administrator workflow; other live integrations still need their own credentials and Google property access.
