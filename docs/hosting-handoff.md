# Blog Machine hosting handoff

The private Site is registered as `appgprj_6b0416adcd288191ba5ea4e6ce511c56`. Its expected address is `https://blog-machine.juresavron.chatgpt.site`; it has not been deployed yet. Current access is restricted to the owning ChatGPT account. Preserve that audience.

## Completed

- Shared API accepts asynchronous hosted storage while preserving local SQLite operation.
- D1 migrations cover drafts, websites, publication records, preparation artifacts, encrypted connector sessions and credentials, and concurrency locks.
- Worker bundles the existing React editor and Express API, requires trusted ChatGPT identity, and serializes writes across Worker instances.
- Mediašped sessions survive Worker replacement, refresh with durable concurrency control, and disconnect without restoring an ambient credential.
- GitHub connection validates a read request and stores its token with authenticated encryption. Tokens never return through status APIs. Private repository files are fetched using the selected credential at an exact commit; caches are separated by credential revision.
- `SESSION_ENCRYPTION_KEY` and `NODE_ENV=production` are configured in the hosted Site. Secret values are not in this repository.

## Validation

Before the workspace disconnect, all 111 original tests passed after the asynchronous storage adaptation. Three additional hosted tests passed, covering token encryption, durable draft storage, and login/refresh/logout across replacement app instances. The Workers preview served the dashboard and API, rejected anonymous requests, and retained a local draft across a Worker rebuild. Public repository reads worked. Private repository reads correctly required a credential.

After recovery, both TypeScript configurations pass. Two additional GitHub tests pass: validation/encryption/disconnection and credential-scoped revision/file reads. The current runtime cannot launch network-enabled commands (`Managed execution requires a usable CODEX_CLI_PATH`); sandboxed HTTP listener tests and Git pushes are unavailable. Do not represent mocked GitHub credential checks as a real authenticated repository connection.

## Finish publication

1. Restore a functioning managed execution runtime. Reuse the existing checkout and Site identity.
2. Run `npm test` and `npm run build:hosted` with Node 24.14 or newer. Use the existing dependency lockfile.
3. Obtain a fresh source credential for this exact Site. Use the Sites `site-workflow.mjs` helper, with the credential through stdin, to push and package the exact tested source. Keep a separate GitHub remote for the public project source.
4. Confirm owner-only access and save/deploy that pushed commit with its matching archive. Follow the returned deployment until terminal success. Do not create a replacement Site.
5. Open the deployed URL as the owner and verify private access, dashboard loading, draft save/reload, repository status, and connection forms. A real Mediašped authenticated draft write still needs the owner's account login and explicit Save website draft action.

The environment/source disconnection did not publish articles, migrate prototype data to production, or change the websites' existing blogs. Production starts with an empty durable database. The local prototype data remains in its original workspace.
