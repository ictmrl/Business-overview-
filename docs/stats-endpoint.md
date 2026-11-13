# Tutorise stats endpoint

In **Settings → Business data → Tutorise stats API endpoint**, the dashboard calls

```
GET {API base URL}{Stats path}        e.g. https://api.tutorise.uk/admin/stats
Authorization: Bearer <token>
```

on every refresh and expects JSON in this shape. Every section and field is
optional: leave out anything you don't track and that panel shows "—". History
arrays are daily, oldest first, ideally the last 30 days.

```jsonc
{
  "subscribers": {
    "total": 1284,          // active + trialing subscriptions
    "newToday": 16,
    "trialing": 86,
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
  "ai": {
    "total": 19059,         // challenges generated, all time
    "today": 640,
    "completionRate": 78.4, // %
    "avgScore": 74.2,       // %
    "bySubject": [{ "name": "Maths", "value": 3323 }],
    "byLevel":   [{ "name": "GCSE",  "value": 8610 }],
    "recent": [{
      "title": "Quadratic equations sprint",
      "subject": "Maths",
      "level": "GCSE",
      "student": "Amelia",  // first name only, or leave out
      "score": 82,          // null while in progress
      "completed": true,
      "createdAt": "2026-11-12T18:04:00Z"
    }]
  }
}
```

The dashboard also accepts a few alternative names: `activeCustomers` for
`active`, `aiChallenges` for `ai`, `daily/weekly/monthly` for
`today/week/month`, and `count` / `subject` / `level` in the breakdown arrays.

## Example route (Express + Prisma)

Add something like this to the Tutorise backend and set `ADMIN_STATS_TOKEN`
as a Railway variable. Rename tables and columns to match your schema.

```js
// routes/adminStats.js
import express from 'express';
import { prisma } from '../db.js';
const router = express.Router();

router.get('/admin/stats', async (req, res) => {
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

Choose **Railway Postgres (direct SQL)** instead and paste the database's
`DATABASE_PUBLIC_URL`. Each metric is a SQL query you can edit under
*Edit SQL queries*. Single numbers return a `value` column, history returns
`date` + `value` rows, and `usageByHour` returns `hour` + `value`. Use
**Test connection** to see which queries fail against your schema. A read-only
Postgres role is strongly recommended:

```sql
CREATE ROLE dashboard_ro LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE railway TO dashboard_ro;
GRANT USAGE ON SCHEMA public TO dashboard_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro;
```
