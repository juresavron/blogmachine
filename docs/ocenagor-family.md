# OcenaGor, OcjenaGor, and ValutoSu

The **OcenaGor · SI / HR / IT** repository connection covers three language destinations from `juresavron/ocenagor-landing-lovable-13`:

| Destination | Language | Content | Release path |
| --- | --- | --- | --- |
| `ocenagor.si` | Slovenian (`sl`) | Canonical source articles and shared covers | Reviewed main-branch merge and the SI Netlify build |
| `ocjenagor.hr` | Croatian (`hr`) | Linked Croatian article data | The website's manual deployment workflow with market `hr` |
| `valutosu.it` | Italian (`it`) | Linked Italian article data | The website's manual deployment workflow with market `it` |

Inspection of source commit `49a11010688d411d83025badb2a7bae835ca2a0d` found 21 Slovenian articles and 17 linked versions in each of Croatian and Italian. The coverage view shows missing counterparts explicitly. Source presence is separate from a verified live publication.

## Connect source access

Local development uses the existing `ocenagor-landing-lovable-13` sibling checkout when present and verifies its origin. An invalid or symlinked checkout is rejected rather than bypassed.

On Netlify, configure **`BLOGMACHINE_GITHUB_TOKEN` in the server/runtime environment**, with a fine-grained GitHub token limited to **Contents: read-only** for `juresavron/ocenagor-landing-lovable-13`. An existing suitable `GITHUB_TOKEN` is also supported. Keep the token out of chat, frontend variables, and source files. Restart/redeploy after changing runtime settings, then refresh the repository connection.

The website repository is private. The GitHub connection used to deploy Blog Machine does not automatically give the running API access to that repository. The hosted reader uses only GitHub GET requests for this fixed repository and its `main` branch. It verifies Git blob hashes and downloads a bounded subset of blog data, tenant metadata, and referenced covers to temporary server storage. It does not execute downloaded source or require a Git executable. Private website source and credentials are not committed into the public Blog Machine repository or included in its deployment bundle.

A fresh remote HEAD check protects article reads and preparation. If the source changes, reload the connection before preparing again. Warm caches are verified and bounded; a server restart can fetch the source again using the configured token. Authentication failures, temporary limits, and missing configuration remain distinct from a ready connection.

## Write a language version

1. Save a Blog Machine post in the destination's language, including a localized title, slug, short description, and body. The connector uses the text you provide; it does not translate it automatically.
2. Open **Repositories → OcenaGor · SI / HR / IT**, then choose the domain and language.
3. For Croatian or Italian, select the related Slovenian source article. Existing language versions keep their original source relationship. A second slug cannot silently create a duplicate version for the same source and language.
4. Review the SEO title, primary keyword, takeaway, and image description. The website appends its domain to Croatian and Italian SEO titles. Shared venue photos keep their approved locale-specific descriptions where the website's image rules take precedence.
5. For a new Slovenian article, select its category, icon, approved cover source, and existing Slovenian CTA template. For a new Croatian or Italian version, choose an existing CTA template from the same language. The shared cover follows the Slovenian source.
6. Prepare and review the patch. Its proposed URL uses the chosen domain and localized slug: `/blog/<localized-slug>`.

The Slovenian article is the canonical internal identity. `localization.ts` links that identity to the Croatian and Italian data. New article families and previously unmapped Slovenian articles receive an optional `editorialArticleKeys` entry in the prepared patch, including the matching type extension. This keeps untranslated locales optional and avoids breaking the existing French content contract. A new Slovenian source must be applied and refreshed before preparing its counterparts.

Updates edit the actual source module, including articles defined in the products or booking spreads. Unrelated articles and retained metadata stay intact. New translations require their own SEO text and use explicit localized CTAs; they do not inherit Slovenian body text or source labels as if translated.

## Review and release

Preparing a patch saves an artifact in Blog Machine. It does not change website source, create a Git commit or PR, merge, deploy, or publish an article. Apply the reviewed patch in the website repository and run its checks before releasing.

```sh
npm run typecheck
npm run check:keys
npm run build:si
VITE_TENANT=si npm run check:seo
```

For Croatia or Italy, replace `si` in the final two commands with `hr` or `it`. If a change affects shared article identity or covers, validate all three tenants. Each build replaces `dist/`, so build and validate each target sequentially and deploy only that target's output.

Slovenia uses its Netlify production build. Croatian and Italian releases use `.github/workflows/deploy.yml` with the selected market, each targeting its own Cloudflare Worker. The generic `cf:deploy` command intentionally refuses an unspecified market. Do not dispatch a live release merely to test the connector.

The website derives canonical URLs, sitemap entries, and cross-domain hreflang from the linked content. After release, verify the exact public article URL and metadata on the intended domain. Search Console setup and Google's indexing decisions remain separate.
