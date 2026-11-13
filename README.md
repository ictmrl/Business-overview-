# Tutorise HQ — business dashboard

A real-time, single-screen overview of Tutorise.uk that runs locally on your Mac.

- **Hero metrics**: subscribers, active customers, MRR and uptime, with animated counters, trend deltas and sparklines. Click a hero card to switch the main chart to it.
- **Live updates**: the server pulls every source on an interval and pushes changes to the browser over Server-Sent Events. Your inbox updates instantly using IMAP IDLE.
- **AI challenges**: answers from the AI tutor that students or parents disputed — totals, open vs reviewed, how often the AI was wrong (upheld rate), why answers are challenged, subjects, outcomes and a live list of what was disputed.
- **Infrastructure**: Railway services with deploy status, CPU and memory, plus HTTP uptime monitors (24h strip, response-time trend, 90-day uptime).
- **Inbox**: read your IMAP mail, search, mark as unread and reply. Replies are sent over SMTP, threaded correctly and copied to Sent.
- **Settings tab**: Railway, business data (API endpoint or direct Postgres), Stripe (optional), email, uptime URLs, passkeys and password.
- **Passkey login**: sign in with Touch ID or iCloud Keychain. A password is kept as a fallback.
- Dark and light themes, with demo data for anything not yet connected.

## Run it

Requires Node.js 20+ (`brew install node`).

```bash
npm install
npm start            # → http://localhost:4747
```

Or double-click **`Start Dashboard.command`** in Finder. It installs dependencies on first run, starts the server and opens your browser.

To have it start automatically whenever you log in:

```bash
scripts/install-launch-agent.sh          # install
scripts/install-launch-agent.sh --uninstall
```

> **Use `http://localhost:4747`, not `127.0.0.1`.** Passkeys are tied to the hostname, and the server redirects 127.0.0.1 to localhost for you.

On first launch you create the owner account, then you're prompted to add a passkey (Touch ID). After that, the sign-in screen offers your passkey automatically.

## Connect your data (Settings tab)

| Section | What you need |
|---|---|
| **Railway** | An account/team token (Account → Tokens) or a project token, plus the project ID. Shows services, latest deployment status, CPU and memory. |
| **Business data** | Either an admin stats endpoint on the Tutorise backend ([contract + example route](docs/stats-endpoint.md); if tutora uses SQLite, use the [ready-made Claude Code prompt](docs/tutora-stats-endpoint-prompt.md)), or the Railway Postgres `DATABASE_PUBLIC_URL` with editable SQL queries. Drives subscribers, active customers, usage, revenue and AI challenges. |
| **Stripe** *(optional)* | A restricted read-only key. When set, MRR and revenue come from Stripe. |
| **Email** | IMAP host/user/app-password, plus SMTP for replies. iCloud: `imap.mail.me.com:993` / `smtp.mail.me.com:587` (untick TLS for 587), using an app-specific password from appleid.apple.com. |
| **Uptime** | URLs to ping from your Mac, e.g. `https://tutorise.uk` and your API health route. |

Each section has a **Test connection** button. Sources you haven't configured show demo data while *General → Show demo data* is on, and are labelled **Demo** at the bottom of the overview.

## Security

- The server binds to `127.0.0.1` only, so it isn't reachable from your network.
- Everything is stored in `~/.tutorise-dashboard/` (`state.json`, mode 600). Tokens, database URLs and email passwords are encrypted with AES-256-GCM using a key kept in `master.key` beside it. Secrets are never sent back to the browser.
- Sessions use httpOnly, SameSite=strict cookies. Cross-origin writes are rejected, password attempts are rate-limited, and the CSP blocks inline scripts and remote content. HTML emails render in a fully sandboxed iframe with remote images blocked.
- Prefer read-only credentials: a read-only Postgres role, a restricted Stripe key, and a project-scoped Railway token.

## Project layout

```
server/
  index.js            Express app, SSE stream, aggregation loop, API routes
  auth.js             password + passkey (WebAuthn) login
  store.js            local state, encrypted secrets
  sources/
    stats.js          Tutorise stats API / Postgres
    railway.js        Railway GraphQL API
    stripe.js         Stripe MRR + revenue
    uptime.js         HTTP monitors
    email.js          IMAP (ImapFlow) + SMTP (Nodemailer)
    demo.js           sample data
public/
  index.html, app.js  single-page UI (no build step)
  charts.js           dependency-free animated SVG charts
  styles.css
```
