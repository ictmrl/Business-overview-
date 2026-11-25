# Deploying Tutorise HQ to Railway

The same code runs on your Mac and on Railway. On Railway it switches to
**hosted mode** automatically, which:

- listens for outside connections and works behind Railway's HTTPS
  (secure `__Host-` cookie, HSTS)
- keeps settings on a Railway volume and takes the encryption key from a
  variable, never a file next to the data
- requires a one-time **setup token** to create the owner account, so nobody
  who finds the address first can claim it
- answers on **one address only** when `DASH_PUBLIC_URL` (or Railway's domain variable) is known; passkeys are tied to the address you use
- requires Touch ID / device PIN for passkey sign-in, offers **passkeys only**,
  and locks password sign-in after repeated failures (5 per IP per 15 minutes;
  20 from anywhere in an hour locks it for an hour)
- can require **Cloudflare Access** on every request (recommended, below)
- refuses to start, with a clear message in the deploy logs, if the key or
  volume is missing, or `DASH_PUBLIC_URL` is malformed

## 1. Create the service

1. In your Railway project (the one with tutora is fine), **+ New → GitHub Repo**
   and pick `ictmrl/Business-overview-`.
2. Under the service's **Settings → Source**, choose the branch to deploy
   (`claude/tutorise-business-dashboard-ufyv8d`, or `main` once it's merged).
3. Railway builds it as a Node app. `railway.json` in the repo sets the start
   command, the `/healthz` health check and restart-on-failure.
4. Keep it at **one replica**. Settings live on a volume, which only one
   instance can use.

## 2. Add a volume

**+ New → Volume**, attach it to the dashboard service and mount it at `/data`.
Railway tells the app where it is (`RAILWAY_VOLUME_MOUNT_PATH`); no variable needed.

## 3. Set the variables

Service → **Variables**:

| Variable | Value |
|---|---|
| `DASH_MASTER_KEY` | Output of `openssl rand -hex 32`. Encrypts your saved tokens and passwords. **Keep a copy somewhere safe** (e.g. your password manager): without it the saved settings can't be read. |
| `DASH_SETUP_TOKEN` | Output of `openssl rand -hex 16`. Only needed for creating the account; delete it afterwards. |
| `DASH_PUBLIC_URL` | The address you'll open, exactly as it appears in the browser's address bar, starting `https://`, e.g. `https://tutorise-hq.up.railway.app` or `https://hq.tutorise.uk`. **Optional:** leave it unset and the dashboard uses whatever address you open it on. Set it when you add a custom domain, so other addresses redirect there. |
| `SESSION_SECRET` *(optional)* | Output of `openssl rand -hex 32`. Keeps you signed in across redeploys; without it each deploy signs you out. |

Leave `PORT` alone; Railway sets it.

## 4. Give it an address

Either:

- **Railway domain (simplest):** Settings → Networking → **Generate Domain**,
  e.g. `tutorise-hq.up.railway.app`. Protected by the dashboard's own sign-in;
  turn on *passkeys only* (step 6).
- **Your own subdomain + Cloudflare Access (most secure):** see step 7. This
  needs a custom-domain slot in Railway (your plan's limit is currently used by
  `tutorise.uk` and `www.tutorise.uk`) and DNS for `tutorise.uk` on Cloudflare.

## 5. First sign-in

1. Deploy, then open the address. You'll see **Welcome to Tutorise HQ** with a
   **Setup token** field.
2. Enter your name, email, a password and the `DASH_SETUP_TOKEN` value.
3. Add a passkey when prompted (Touch ID). Passkeys made on `localhost` don't
   carry over: each address needs its own.
4. Remove `DASH_SETUP_TOKEN` from the variables.

### If sign-in says “Bad origin”

The page you're on isn't the address the dashboard accepts. The message names
both, e.g. *“this page is open at https://a…, but the dashboard only accepts
https://b…”*. Open the accepted address, or change `DASH_PUBLIC_URL` to the
address you want (or delete it to use the Railway domain) and redeploy. The
deploy log also records the refused address.

## 6. Lock down sign-in

**Settings → Security & login**:

- Add a second passkey from another device (e.g. your iPhone) so losing one
  device doesn't lock you out.
- Tick **Passkeys only**. The password form disappears from the sign-in page and
  password sign-ins are refused.
- If you're ever locked out: set `DASH_ALLOW_PASSWORD=1`, redeploy, sign in
  with your password, fix your passkeys, then remove the variable.

## 7. Cloudflare Access (recommended)

Access puts an email check in front of the dashboard, so the sign-in page isn't
even reachable by anyone else. The dashboard verifies Cloudflare's signed token
on every request, so going straight to the `*.up.railway.app` address doesn't
get round it.

1. In Railway, add the custom domain (e.g. `hq.tutorise.uk`) to the dashboard
   service and create the CNAME it shows in Cloudflare DNS, **proxied** (orange cloud).
2. Cloudflare dashboard → **Zero Trust → Access → Applications → Add → Self-hosted**:
   domain `hq.tutorise.uk`; policy **Allow**, include **Emails** = your address.
3. Copy the application's **Audience (AUD) tag**, and note your team domain
   (`<team>.cloudflareaccess.com`, under Zero Trust → Settings).
4. Railway variables:

   | Variable | Value |
   |---|---|
   | `DASH_PUBLIC_URL` | `https://hq.tutorise.uk` |
   | `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | the AUD tag |
   | `TRUST_PROXY_HOPS` | `2` (Cloudflare + Railway), so sign-in limits see your real IP |

5. Redeploy. The log line says `Cloudflare Access required`, and opening the
   Railway domain directly now returns *Forbidden*. Register a passkey on the new
   address (step 5.3).

## 8. Reconnect your data

**Railway:** the simplest is a **project token** (your project → Settings →
Tokens): paste it and leave Project ID blank. An account or workspace token
also works with the Project ID. The dashboard works out which kind you've
pasted; *Test connection* says which it used.

<!-- -->


The hosted copy starts empty: your Mac's settings stay on your Mac. In
**Settings**, re-enter Railway, Business data (`https://tutorise.uk`,
`/api/admin/stats`, token), Stripe, AI costs, email and uptime URLs, and use
**Test connection** on each.

Notes:

- **Uptime checks now run from Railway**, the same provider as tutora, so a
  Railway-wide outage could take down both the site and the monitor.
- **Email replies:** if *Send reply* times out while IMAP works, your Railway
  plan may restrict outbound SMTP. Check Railway's current SMTP policy for
  your plan.
- **Private stats route (optional):** with both services in the same Railway
  project, the dashboard can call tutora over Railway's private network
  (`http://tutora.railway.internal:8080`) instead of the public address. This
  works only if tutora listens on all interfaces, IPv6 included.

## Running on your Mac

Unchanged: `npm start` and `http://localhost:4747`. None of the variables
above are needed locally.
