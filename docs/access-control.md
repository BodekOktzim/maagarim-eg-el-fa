# Access Control Deployment

## Required Render environment variables

Set these values in the Render service environment, never in Git:

- `POSTGRES_URL` — PostgreSQL connection string. The service runs all SQL migrations on startup.
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile server secret. Production login fails closed when it is missing.
- `WEB_APP_ALLOWED_ORIGIN` — the exact browser origin, for example `https://bodekoktzim.github.io`.
- `ADMIN_BOOTSTRAP_SECRET` — one-time secret used only to create the first admin.
- `VITE_TURNSTILE_SITE_KEY` — public Turnstile site key returned to GitHub Pages by `/api/public-config`; safe to expose, but configure it in Render.
- `VITE_API_BASE_URL` — Render API URL when building the GitHub Pages bundle, for example `https://maagarim-web-search-api.onrender.com`.

Existing service variables such as `TAVILY_API_KEY` must be preserved.

## First admin

After the service is connected to PostgreSQL and deployed, call the one-time endpoint from a secure machine:

```bash
curl -X POST "$RENDER_URL/api/admin/bootstrap" \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Bootstrap-Secret: $ADMIN_BOOTSTRAP_SECRET" \
  -d '{"email":"admin@example.com","password":"use-a-unique-12-plus-character-password"}'
```

The endpoint refuses to create a second admin. Remove or rotate `ADMIN_BOOTSTRAP_SECRET` after successful bootstrap.

## Access passwords

1. Open `$RENDER_URL/admin`.
2. Sign in with the first admin account.
3. Create an access password and select a fixed duration or unlimited validity.
4. Copy an automatically generated password immediately; it is not displayed again.
5. Revoke a password when access must stop. The disconnect action also revokes its active Sessions.

## Security behavior

- Access passwords are stored as scrypt hashes.
- Browser sessions use secure, HttpOnly, host-only cookies.
- Browser cookies use `SameSite=None; Secure` because GitHub Pages and Render are cross-site; the backend only allows the exact configured GitHub Pages origin and credentials.
- Access sessions expire after 30 minutes, or sooner if the access code itself has a shorter fixed validity. Expiry is enforced server-side on every protected data request.
- Search index/source range requests are proxied through the authenticated backend.
- Login events, failed attempts and admin logins are written to PostgreSQL.
- `/api/public-config` returns only the public Turnstile site key; it never returns the server-side secret.
- The existing search code and data files are not modified or deleted by the access-control migration.
