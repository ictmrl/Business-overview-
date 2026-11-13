# Tutorise stats endpoint

In **Settings → Business data → Tutorise stats API endpoint**, the dashboard calls

```
GET {API base URL}{Stats path}        e.g. https://tutorise.uk/api/admin/stats
Authorization: Bearer <token>
```

on every refresh and expects JSON in this shape. Every section and field is
optional: leave out anything you don't track and that panel shows "—". History
arrays are daily, oldest first, ideally the last 30 days.

```jsonc
{
  "accounts": {
    "parents": 1046,        // parent / account-holder users
    "students": 1515,       // child / student profiles
    "parentsPaid": 912,     // parents with a paid plan
    "parentsTrialing": 71,  // parents on a trial (and not paid)
    "studentsPaid": 1404,   // students covered by a paid plan
    "studentsTrialing": 97,
    "parentsNewToday": 4,
    "studentsNewToday": 6
  },
  "subscribers": {
    "paid": 1198,           // active, paying subscriptions
    "trialing": 86,         // on a free trial
    "total": 1284,          // optional: defaults to paid + trialing
    "trialsEndingSoon": 19, // trials ending within 3 days
    "newToday": 16,
    "newTrialsToday": 7,
    "churnRate": 2.1,       // % over the last 30 days
    "history": [{ "date": "2026-10-14", "value": 1010 }]
  },
  "active": {
    "live": 9,              // users online in the last ~5 minutes
    "today": 1116,          // distinct users active today
    "week": 2140,
    "month": 3310,
    "history": [{ "date": "2026-10-14", "value": 900 }]
  },
  "usage": {
    "sessionsToday": 3019,
    "minutesToday": 70640,
    "avgSessionMinutes": 23.4,
    "byHour": [12, 8, 4, 2, 1, 3, 10, 40, 90, 120, 110, 95, 80, 70, 90, 180, 320, 400, 380, 260, 140, 70, 30, 0],
    "history": [{ "date": "2026-10-14", "value": 2400 }]
  },
  "revenue": {              // ignored if Stripe is connected
    "currency": "GBP",
    "mrr": 14638,
    "today": 242,
    "month": 3644,
    "history": [{ "date": "2026-10-14", "value": 410.5 }]
  },
  "ai": {                    // AI challenges = answers from the AI tutor that a
                             // student or parent disputed (e.g. an AiChallenge table)
    "total": 412,            // all time
    "today": 4,
    "week": 31,              // optional
    "open": 10,              // waiting for review
    "upheldRate": 31.6,      // % of reviewed challenges (last 30 days) where the AI was wrong
    "bySubject": [{ "name": "Maths", "value": 78 }],              // last 30 days
    "byReason":  [{ "name": "Answer is wrong", "value": 73 }],    // why it was disputed
    "byOutcome": [{ "name": "rejected", "value": 118 }, { "name": "upheld", "value": 54 }, { "name": "open", "value": 9 }],
    "history":   [{ "date": "2026-10-15", "value": 6 }],          // challenges per day
    "recent": [{             // latest 12, no names or personal data
      "summary": "Solve 3x² − 12 = 0: tutor said x = 4 only",   // what was disputed (≤240 chars)
      "subject": "Maths",
      "reason": "Answer is wrong",
      "status": "open",      // open | upheld | rejected (other values shown as-is)
      "createdAt": "2026-11-13T09:00:00Z"
    }]
  }
}
```

The overview's **Accounts** card shows parents, students, students per parent,
and subscriptions per parent. When subscriptions per parent roughly matches
students per parent, the card notes that subscriptions look like they're
counted **per child**, which is why the subscriber total can be higher than
your number of families.

The dashboard also accepts a few alternative names: `families` / `children`
for `parents` / `students`, `activeCustomers` for
`active`, `aiChallenges` for `ai`, `daily/weekly/monthly` for
`today/week/month`, `count` in the breakdown arrays, `byStatus` for
`byOutcome`, and `question` or `title` for a challenge's `summary`.

### What the dashboard actually displays

Everything above is optional. If you're short on time, these are the fields
the screens use; the rest (`churnRate`, `active.week/month`, `usage.minutesToday`,
`usage.avgSessionMinutes`, `usage.history`) are accepted but not shown yet.

- `accounts`: all fields
- `subscribers`: `paid`, `trialing`, `trialsEndingSoon`, `newToday`, `newTrialsToday`, `history`
- `active`: `live`, `today`, `history`
- `usage`: `sessionsToday`, `byHour`
- `revenue`: `mrr`, `today`, `month`, `history` (skip if Stripe is connected)
- `ai`: all fields

## Example route (Express + Prisma)

Add something like this to the Tutorise backend and set `ADMIN_STATS_TOKEN`
as a Railway variable. Rename tables and columns to match your schema.

```js
// routes/adminStats.js
import express from 'express';
import { prisma } from '../db.js';
const router = express.Router();

router.get('/api/admin/stats', async (req, res) => {
  if (req.get('authorization') !== `Bearer ${process.env.ADMIN_STATS_TOKEN}`) return res.sendStatus(401);
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const [subs] = await q(`SELECT count(*)::int AS total FROM subscriptions WHERE status IN ('active','trialing')`);
  const subsHist = await q(`SELECT to_char(d,'YYYY-MM-DD') AS date,
      (SELECT count(*) FROM subscriptions s WHERE s.created_at < d + interval '1 day'
        AND (s.canceled_at IS NULL OR s.canceled_at >= d + interval '1 day'))::int AS value
    FROM generate_series(current_date - 29, current_date, interval '1 day') d`);
  const [ai] = await q(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE created_at >= current_date)::int AS today FROM ai_challenges`);
  const bySubject = await q(`SELECT subject AS name, count(*)::int AS value FROM ai_challenges
    WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  const recent = await q(`SELECT title, subject, level, score, completed_at IS NOT NULL AS completed,
      created_at AS "createdAt" FROM ai_challenges ORDER BY created_at DESC LIMIT 12`);
  res.json({ subscribers: { total: subs.total, history: subsHist }, ai: { ...ai, bySubject, recent } });
});
export default router;
```

Keep the endpoint read-only and don't return personal data beyond what you
want on screen.

## Or skip the endpoint: direct Postgres

**Quickest route:** choose *Railway Postgres (direct SQL)*, paste the URL and
press **Detect from database**. The dashboard reads your table and column
names (plus the distinct values of role/status columns, no customer data),
works out where parents, students, subscriptions and trials live, and offers
generated queries for subscribers, trials, and parents/students by plan.
It handles snake_case tables and Prisma-style `"User"` / `"createdAt"` names.
The schema summary it shows is safe to share if you need help mapping the rest.

Subscriber history needs a created-at column. If there isn't one (or the query
fails), the chart uses the dashboard's own daily snapshots instead, starting
from the day you connect.

If Stripe is connected, any subscriber counts this endpoint leaves out
(`paid`, `trialing`, `trialsEndingSoon`, `newTrialsToday`) are filled in from
Stripe's active and trialing subscriptions.

Choose **Railway Postgres (direct SQL)** instead and paste the database's
`DATABASE_PUBLIC_URL`. Each metric is a SQL query you can edit under
*Edit SQL queries*. Single numbers return a `value` column, history returns
`date` + `value` rows, and `usageByHour` returns `hour` + `value`. Use
**Test connection** to see which queries fail against your schema. Failing
queries also show up in a banner on the overview, and their panels show "—"
instead of 0. Subscribers are counted with `subscribersPaid` and
`subscribersTrialing` (the total is their sum unless you fill in
`subscribersTotal`). If trials live on your users table rather than in
`subscriptions`, point `subscribersTrialing` there, for example
`SELECT count(*)::int AS value FROM users WHERE trial_ends_at > now()`. A read-only
Postgres role is strongly recommended:

```sql
CREATE ROLE dashboard_ro LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE railway TO dashboard_ro;
GRANT USAGE ON SCHEMA public TO dashboard_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro;
```
