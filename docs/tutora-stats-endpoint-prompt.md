# Prompt: add a stats endpoint to tutora

If Tutorise's database can't be reached directly (for example it's SQLite on
the tutora service's volume), the dashboard reads its numbers from a small,
read-only, token-protected route inside tutora instead.

Open the **tutora** project in Claude Code and paste everything in the box
below. When it's deployed, configure the dashboard as described at the end.

---

```text
Add a read-only admin stats endpoint for my business dashboard.

Route: GET /api/admin/stats (if an admin stats route already exists, keep its path and auth and reshape its response)
Auth: require header `Authorization: Bearer <token>` where the token comes from a
new environment variable ADMIN_STATS_TOKEN. Compare in constant time. Return 401
if missing or wrong, and 503 if ADMIN_STATS_TOKEN isn't set. No other auth, no
cookies, no CORS. The route must never write to the database.

Response: JSON in exactly this shape. Work out from our own schema how each
number is derived, and leave out any field we genuinely can't compute (don't
invent values). Counts are integers; history arrays are daily, oldest first,
for the last 30 days, with dates as "YYYY-MM-DD".

{
  "accounts": {
    "parents": 0,            // parent / account-holder users
    "students": 0,           // child / student profiles
    "parentsPaid": 0,        // parents with a currently paid plan
    "parentsTrialing": 0,    // parents on a trial and not paid
    "studentsPaid": 0,       // students covered by a paid plan
    "studentsTrialing": 0,   // students covered by a trial (and not paid)
    "parentsNewToday": 0,
    "studentsNewToday": 0
  },
  "subscribers": {
    "paid": 0,               // active paid subscriptions
    "trialing": 0,           // subscriptions currently on a free trial
    "trialsEndingSoon": 0,   // trials ending within the next 3 days
    "newToday": 0,           // new subscriptions (paid or trial) created today
    "newTrialsToday": 0,
    "history": [{ "date": "2026-10-15", "value": 0 }]   // paid + trialing on each day
  },
  "active": {
    "live": 0,               // users active in the last 5 minutes, if we track it
    "today": 0,              // distinct users active today
    "week": 0,
    "month": 0,
    "history": [{ "date": "2026-10-15", "value": 0 }]   // distinct active users per day
  },
  "usage": {
    "sessionsToday": 0,
    "minutesToday": 0,
    "byHour": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "history": [{ "date": "2026-10-15", "value": 0 }]   // sessions per day
  },
  "revenue": {
    "currency": "GBP",
    "mrr": 0,                // monthly recurring revenue in pounds (not pence)
    "today": 0,
    "month": 0,
    "history": [{ "date": "2026-10-15", "value": 0 }]
  },
  "ai": {                    // AI challenges = answers from the AI tutor that a
                             // student or parent disputed (e.g. an AiChallenge table)
    "total": 0,            // all time
    "today": 0,
    "week": 0,              // optional
    "open": 0,              // waiting for review
    "upheldRate": 0,      // % of reviewed challenges (last 30 days) where the AI was wrong
    "bySubject": [{ "name": "Maths", "value": 0 }],              // last 30 days
    "byReason":  [{ "name": "Answer is wrong", "value": 0 }],    // why it was disputed
    "byOutcome": [{ "name": "rejected", "value": 0 }, { "name": "upheld", "value": 0 }, { "name": "open", "value": 0 }],
    "history":   [{ "date": "2026-10-15", "value": 0 }],          // challenges per day
    "recent": [{             // latest 12, no names or personal data
      "summary": "Solve 3x² − 12 = 0: tutor said x = 4 only",   // what was disputed (≤240 chars)
      "subject": "Maths",
      "reason": "Answer is wrong",
      "status": "open",      // open | upheld | rejected (other values shown as-is)
      "createdAt": "2026-11-13T09:00:00Z"
    }]
  }
}

Requirements:
- Use our existing database client/ORM and models; keep queries efficient
  (aggregate in the database, don't load whole tables into memory).
- Cache the computed response in memory for 30 seconds.
- Don't include emails, surnames, payment details or any other personal data.
- If revenue lives only in Stripe, it's fine to omit "revenue" (the dashboard
  can read Stripe directly).
- "ai" is about AI challenges: answers from the AI tutor that a student or
  parent disputed. Map our challenge/flag statuses to open / upheld (the AI was
  wrong) / rejected (the AI's answer stood).
- You can skip churnRate, active.week/month, usage.minutesToday,
  usage.avgSessionMinutes and usage.history: the dashboard doesn't show them yet.
- Add a short test for the 401 path, and document ADMIN_STATS_TOKEN in the README.
- Tell me exactly which tables/columns each number comes from when you're done.
```

---

## Then

1. **Generate a token** on your Mac: `openssl rand -hex 32`
2. **Railway** → tutora → **Variables** → add `ADMIN_STATS_TOKEN` with that value
   (Railway redeploys automatically).
3. **Check it** (should print JSON, and 401 without the header):
   `curl -H "Authorization: Bearer <token>" https://tutorise.uk/api/admin/stats`
4. **Dashboard** → Settings → Business data:
   - Source: *Tutorise stats API endpoint*
   - API base URL: `https://tutorise.uk`
   - Stats path: `/api/admin/stats`
   - Bearer token: the same token
   - **Test connection**, then **Save**.
