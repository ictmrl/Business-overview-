// Task scheduling rules, shared by the server and the browser so both agree on
// due dates and colours. Dates are plain "YYYY-MM-DD" strings (calendar days,
// no time zone), compared as strings.

export const REPEATS = {
  none: { label: 'One-off' },
  weekly: { label: 'Weekly', days: 7 },
  fortnightly: { label: 'Fortnightly', days: 14 },
  monthly: { label: 'Monthly', months: 1 },
  quarterly: { label: 'Quarterly', months: 3 },
  '6months': { label: 'Every 6 months', months: 6 },
  annually: { label: 'Annually', months: 12 },
};

export const AMBER_DAYS = 7; // amber from a week before the due date (inclusive), red once it has passed

const pad = (n) => String(n).padStart(2, '0');
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)))
  && toDate(s).toISOString().slice(0, 10) === s;
const toDate = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
const fromDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m: 0-11

/** Today's calendar date in a time zone (default Europe/London). */
export function todayIn(timeZone = 'Europe/London', now = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return fromDate(now); }
}

export const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86_400_000);
export const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fromDate(d); };

/**
 * One step forward in a task's schedule. Monthly steps keep the task's anchor
 * day: the 31st falls on the last day of shorter months, then returns to the 31st.
 */
export function step(dateStr, repeat, anchorDay) {
  const r = REPEATS[repeat];
  if (!r || repeat === 'none') return null;
  if (r.days) return addDays(dateStr, r.days);
  const d = toDate(dateStr);
  const total = d.getUTCMonth() + r.months;
  const y = d.getUTCFullYear() + Math.floor(total / 12), m = ((total % 12) + 12) % 12;
  const day = Math.min(anchorDay || d.getUTCDate(), daysInMonth(y, m));
  return `${y}-${pad(m + 1)}-${pad(day)}`;
}

/** green | amber | red for an open task on a given day. */
export function statusOf(task, today) {
  if (task.done) return 'done';
  const d = daysBetween(today, task.dueDate);
  if (d < 0) return 'red';
  if (d <= AMBER_DAYS) return 'amber';
  return 'green';
}

/** Plain-words due label: "Overdue by 3 days", "Due today", "Due in 5 days", "Due 12 Dec". */
export function dueLabel(task, today) {
  const d = daysBetween(today, task.dueDate);
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? '' : 's'}`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d <= AMBER_DAYS) return `Due in ${d} days`;
  return 'Due ' + toDate(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: task.dueDate.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' });
}

/**
 * Next due date after completing a repeating task: steps from the current due
 * date (keeping the schedule), skipping dates that have already passed.
 */
export function nextDueAfterDone(task, today) {
  let next = step(task.dueDate, task.repeat, task.anchorDay);
  for (let i = 0; next && next < today && i < 1000; i++) next = step(next, task.repeat, task.anchorDay);
  return next;
}

/** Dates on which an open task falls between from and to (inclusive), for the calendar. */
export function occurrences(task, from, to, max = 62) {
  if (task.done) return [];
  const out = [];
  let d = task.dueDate;
  for (let i = 0; d && d <= to && out.length < max && i < 2000; i++) {
    if (d >= from) out.push(d);
    if (task.repeat === 'none') break;
    d = step(d, task.repeat, task.anchorDay);
  }
  return out;
}

export function summarise(tasks, today) {
  const s = { green: 0, amber: 0, red: 0 };
  for (const t of tasks) { const st = statusOf(t, today); if (st in s) s[st]++; }
  return s;
}
