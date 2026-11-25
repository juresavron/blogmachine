# Connecting your websites

Blog Machine has two separate workflows. **Repository connections** reads the inspected website checkouts and prepares content artifacts for review. **Websites** handles the existing WordPress, manual export, and demo destinations. Mediašped and OcenaGor.si use their actual Supabase and static-source structures; they do not need a WordPress connector or a separate MCP server on each website.

## Repository connections

The hub contains nine entries. Repository identities below are under `juresavron/` on GitHub. Source article counts describe the inspected checkout, not verified live publication.

| Website / repository | Content source and implemented behavior | Remaining publication step |
| --- | --- | --- |
| Mediašped / `mediasped-landing-lovable-15` | Supabase `public.blog_posts`; nine language destinations; account login, published-article listing, admin verification, unpublished JSON preparation, and separate remote draft insertion | Connect an existing administrator account, then explicitly save a website draft. Review and publish in the existing Mediašped editor. Public article access works; live administrator login and draft insertion still need your account. |
| OcenaGor / `ocenagor-landing-lovable-13` | SI, HR, and IT linked article adapters: `ocenagor.si`, `ocjenagor.hr`, and `valutosu.it`; localized source patches and shared cover/identity changes | Review the patch and selected tenant checks. SI uses Netlify; HR/IT use the website’s market-specific manual Cloudflare workflow. [Family setup](ocenagor-family.md). |
| LogisticsWorld / `logistiscworld` | Four static articles in `src/data/blog.ts`, serving `logisticsworld.eu`; Git patch preparation | Review site checks and explicitly deploy the Cloudflare Worker. Public homepage and article routes currently return `index, follow`; verify each released URL and its metadata. This is not the Mediašped blog source. |
| Onlyworld / `onlyworld` | Static content for 25 configured country/language markets; Git patch preparation | Review the correct market and language, run site checks, and merge through the actual deployment workflow. Pushes to `main` trigger automatic deployment. |
| Lumina Pergole / `lumina` | Three static guides in `src/data/guides.ts`, targeting `pergola-lumina.si/nasveti/`; Git patch preparation | Netlify project `luminakoper` deploys `main` to `pergola-lumina.si`. Use the production source snapshot, run website checks, and review the patch before merging. The GitHub default branch is a separate development branch. |
| Trgovina / `trgovina` | Supabase `public.posts` for `bazen` and `vrecke`; published-article listing, read-only admin test, and draft JSON export | Create the draft through the authorized external admin workflow. Blog Machine does not write Trgovina rows. Static buying guides and comparison pages are separate from this database blog. |
| Pultaro / `pultaro` | Empty repository placeholder | Build a website and content storage first. |
| Agencija delavci / `agencijadelavci` | Empty repository placeholder | Confirm its purpose and build its blog first. |
| Klicni center / `klicnicenter` | Empty repository placeholder | Build a public website and blog first. |

There are four Git adapters and two database profiles. An available checkout establishes source access, not database administrator access, a live website connection, or a successful production deployment. Trgovina's `vrecke` tenant is marked pre-launch; production custom-domain routing is unverified.

## Hosted source connections

The hosted app does not have sibling repository checkouts. Import a source snapshot using **Repository connections → select website → Source snapshot (JSON)**. Blog Machine accepts only the fixed adapter files, checks their Git blob hashes, and parses static content without executing website code. Ocenagor image files are represented by original Git path/hash/size metadata; their binary data is not copied.

Snapshots are stored in the private workspace database, separate from this public GitHub repository and frontend assets. They survive deployments and server restarts. The displayed branch and commit describe the imported revision, not a live GitHub sync. Export and import a fresh snapshot after website changes. Applying any prepared patch still requires checking the current destination source and running its build gates.

From a trusted workspace with the website checkout, export a snapshot with:

```sh
node --import tsx scripts/export-source.ts --id mediasped --workspace /workspace
```

Use IDs `mediasped`, `ocenagor`, `logistiscworld`, `onlyworld`, `lumina`, or `trgovina`. The exporter reads committed content from the verified repository origin. Its default `source-snapshots/` output is ignored by Git. Keep these files private. Administrator sessions and credentials are not included, and importing source never publishes an article or creates a website draft.

## Prepare and review a change

1. Save a Blog Machine post with a title, slug, short description, and body. Although the general editor allows an empty short description, repository preparation requires one. Use lowercase words separated by hyphens for the slug and plain text without literal `<` characters. Body lines beginning with `## ` become section headings.
2. Open **Repository connections**, select the repository and its destination, and load its existing articles. Write in the chosen destination's language; the hub does not translate text.
3. Fill in the destination's required metadata, then choose **Prepare change**. Git preparation requires the current checkout HEAD and the source hash returned by the article list. Changes to either require reloading before preparing again.
4. Review the generated patch or JSON and download it. The artifact and its preparation record are stored in the workspace database (Postgres on Netlify, SQLite locally). An expected article URL is a proposed destination, not evidence of a published page.
5. Complete the destination's separate draft or deployment workflow. Preparing an artifact makes no website source edits, commits, pushes, deployments, or remote database writes.

Generated Git content is parsed and validated against its adapter's schema. A downloadable patch does not establish that the complete website builds or that its production routes work. Before applying a patch, recheck the destination checkout and run that site's documented build and tests. Static sites include content at build time; keep unapproved drafts in Blog Machine.

### Destination metadata

- **OcenaGor family:** Slovenian articles provide the canonical identity, category/icon, and shared cover. Croatian and Italian versions use explicit source pairing, localized slugs, SEO text, image descriptions, and same-language CTA templates. New family keys and optional translation types are included in the reviewed patch when needed. The site derives canonical and hreflang URLs from these relationships. See [the three-domain workflow](ocenagor-family.md) for required metadata, source access, and release checks.
- **LogisticsWorld:** Choose category, artwork, publication date, and takeaway. The date is article metadata; it does not schedule deployment. No source references are generated, and existing references are retained when omitted on an update.
- **Onlyworld:** Select a market and a directory link. Existing city associations and other retained article metadata are preserved when updating the same slug. Each market requires suitable original language content; no automatic translation occurs. `ocenagor.si` is not one of these country domains.
- **Lumina:** Title, description, and body sections become a static guide. All guides included in a deployed build are published; there is no website-side draft status in this adapter.

## Mediašped database drafts

The verified repository is `juresavron/mediasped-landing-lovable-15`. It uses Supabase project `ytmowbzkpofeeocgevyr.supabase.co`, `public.blog_posts`, and an existing administrator editor. Destinations are English (`en`), Slovenian (`sl`), Arabic (`ar`), Slovak (`sk`), Hungarian (`hu`), Czech (`cs`), German (`de`), Croatian (`hr`), and Italian (`it`).

The server normally reads the public Supabase URL and publishable key from `src/integrations/supabase/client.ts` in that fixed repository checkout. Optional `MEDIASPED_SUPABASE_URL` and `MEDIASPED_SUPABASE_ANON_KEY` environment overrides are supported; the URL must match the verified project. These public constants do not grant administrator access.

### Connect your account

The connection form also supports email verification for existing accounts. Enter the account email and choose **Email me a sign-in link**; paste the original Supabase link or code into the verification field. Blog Machine requests `create_user: false`, binds the challenge to this browser for ten minutes, and checks the existing administrator role before connecting. This does not create users, reset passwords, publish content, or change the website's authentication configuration. Session and refresh-token handling is the same as password sign-in.


Open **Repository connections → Mediašped → Connect account** and sign in with the email and password for an existing Mediašped administrator account. Blog Machine authenticates against the verified Supabase project and checks the existing `is_admin` RPC. An ordinary signed-in account without administrator access cannot save website drafts. There is no signup flow, and service-role credentials are unsupported.

Passwords are used for sign-in and are not retained. Access and refresh tokens stay in server memory; they are never returned to the browser or written to SQLite, files, or browser storage. The browser receives an opaque session cookie with HttpOnly, SameSite=Strict, and Path=/api. This connection authenticates Mediašped actions; it does not add general authentication to the single-user Blog Machine application.

Blog Machine automatically refreshes the access token before expiry, serializing concurrent refresh requests. A session has an eight-hour absolute lifetime. Reconnect when that limit is reached, after a failed refresh, or after restarting the server, which clears in-memory sessions. **Disconnect** removes this browser's session and prevents its requests from silently falling back to a server environment token; use **Connect account** to sign in again.

For optional headless/server use, `MEDIASPED_SUPABASE_ACCESS_TOKEN` still accepts a raw JWT from a signed-in administrator. This is not required for the normal account form. It is a short-lived fallback with no refresh token, so refresh it externally. A service-role key or proxy placeholder cannot substitute for the user JWT validated locally. Never put credentials in source, SQLite, chat, or saved setup instructions.

**Prepare change** generates a JSON artifact with a stable UUID, `published: false`, and `published_at: null`. This step works without an administrator token and does not send a draft to the website. Static guide slugs are reserved, and database slugs are globally unique across languages: language versions need distinct slugs.

After connecting your administrator account, choose **Test connection** when you need to recheck access. Review the prepared JSON, then use the separate **Save website draft** action. The server verifies administrator access again, inserts the same stable draft ID, and checks that the returned row matches the unpublished payload and author. It never upserts, overwrites an existing article, or publishes it. If the result is uncertain, retry the same prepared ID; generating a new draft could create duplicates. Final review and publication happen in the existing Mediašped editor.

Automated authentication and remote-save tests use mocked services. A live public request for Slovenian published articles succeeded and returned an empty list. This does not verify administrator access. Real account login and an authenticated remote draft insertion remain unvalidated until you sign in securely; development checks have not created remote content.

## Trgovina database exports

Trgovina uses Supabase project `cybwzhgretztcjfdefoy.supabase.co`. Its two destinations are Masažni bazeni Vrelec (`bazen`, `masaznibazenivrelec.si`) and Kofeinske vrečke Zagon (`vrecke`, `kofeinskevreckezagon.si`). The server reuses public configuration from the checkout's `wrangler.jsonc`, or the optional `TRGOVINA_SUPABASE_URL` and `TRGOVINA_SUPABASE_ANON_KEY` overrides.

Published article listing reads `public.posts`, filtered to the chosen shop. To test authenticated administrator access, securely configure `TRGOVINA_SUPABASE_ACCESS_TOKEN` with a signed-in user's access token. The connection test checks identity and the existing admin RPC without changing content; service-role credentials are unsupported. Refresh sessions externally. Live database access remains unvalidated.

Preparation exports JSON with a stable UUID, `status: "draft"`, and `published_at: null`. There is no **Save website draft** action for Trgovina. Use its authorized external admin workflow to create the draft. Existing static buying guides and comparisons are not rows in this blog and are not managed by this connector.

## Checkouts and cloud environment

Repository connections read sibling checkouts under `/workspace` by default. `BLOGMACHINE_REPOSITORIES_ROOT` can select another parent directory. Keep the catalog's repository identities and directory names intact; the server checks each checkout's origin. Use the existing checkouts: each cloud task is already isolated, so no extra Git worktree is needed.

Check the actual checkout availability rather than assuming every website repository is installed. All supported adapters can use private imported snapshots when local checkouts are absent. The hosted OcenaGor family reader can also use a scoped read-only GitHub token when neither a checkout nor a saved snapshot is available. Parsing source does not install or build every destination website. See [Netlify deployment](netlify-deployment.md) for the app's hosted runtime and storage.

Inspect the current network policy before using live integrations. Google needs `searchconsole.googleapis.com` and `www.googleapis.com`; database profiles need their configured Supabase hosts; the hosted OcenaGor source reader needs `api.github.com`. Repository read access does not supply website administrator access or publishing permission.

## WordPress, manual export, and demos

Use **Websites** for destinations that actually use WordPress, manual copy/paste, or the local demo flow. A public **Check website** request detects metadata without credentials or content changes; it does not establish authentication. For a WordPress destination, save its canonical HTTPS URL and note its credential prefix, then securely configure the matching `<PREFIX>_URL`, `<PREFIX>_USERNAME`, and `<PREFIX>_APPLICATION_PASSWORD`. The URL must exactly match the saved website, including an installation subdirectory when present.

Create an application password for an account permitted to publish, restart the server, and choose **Test connection**. Authentication without an explicit capability response verifies login only. **Publish post** immediately publishes to WordPress; known publications are updated on republish. An uncertain create result pauses automatic retries until reconciled. The connector supports plain-text titles, descriptions, and bodies; it does not manage images, categories, scheduling, or custom post types. Manual destinations use text export, and demos create only local records.

## Search Console is a separate connection

Publishing access is separate from Google access. Save the exact verified Search Console property for the destination and configure `GOOGLE_ACCESS_TOKEN` securely with the `https://www.googleapis.com/auth/webmasters` scope and property access. Google API access requires `searchconsole.googleapis.com` and `www.googleapis.com`. Refresh the short-lived token externally.

Blog Machine can inspect actual published URLs and submit a sitemap the website already serves. It does not generate a sitemap or force indexing. Demo publications cannot be inspected or submitted. LogisticsWorld's successful public article pages allow indexing; disabled, filtered, or error routes can still use `noindex`. Verify the specific URL before submitting it.

