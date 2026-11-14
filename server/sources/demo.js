// Realistic, gently drifting sample data so the dashboard looks alive before
// any real connection is configured. Each section is used only for sources
// that are not configured while Demo mode is on.
const day = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const rnd = (a, b) => a + Math.random() * (b - a);
let seed = 7;
const srand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function series(days, start, growth, noise) {
  seed = Math.round(start * 13) || 7;
  const out = [];
  let v = start;
  for (let i = days - 1; i >= 0; i--) {
    v = Math.max(0, v * (1 + growth) + (srand() - 0.45) * noise);
    out.push({ date: iso(Date.now() - i * day), value: Math.round(v * 100) / 100 });
  }
  return out;
}

const live = { subs: 1284, active: 0, sessions: 0, revenueToday: 0, ai: 412, aiToday: 0 };
const started = Date.now();

const SUBJECTS = ['Maths', 'English', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'History', 'French'];
// Sample AI challenges by type (see aitypes.js); summaries are illustrative only.
const TYPE_SAMPLES = {
  'Response unsure': ['Tutor hedged on the method for completing the square', 'Low confidence on Macbeth Act 3 interpretation', 'Unsure which formula applies for compound interest'],
  'Content drift': ['Moved from GCSE photosynthesis into A-level light-dependent reactions', 'Session on fractions drifted into algebra'],
  'Reported errors': ['Student reported wrong answer for 3x² − 12 = 0', 'Parent reported incorrect date for Treaty of Versailles'],
  Reversals: ['Tutor changed its answer on resistors in parallel after pushback', 'Reversed marking on a persuasive essay paragraph'],
  'Rule breaks': ['Gave the full answer instead of a hint on homework question', 'Went beyond session scope rules'],
  'Unsupported claims': ['Stated a statistic about exam pass rates without a source', 'Claimed a historical quote with no reference'],
  'Board claims': ['Said AQA requires a method that isn’t in the spec', 'Quoted an Edexcel grade boundary as fact'],
  'Verifier findings': ['Verifier disagreed with the worked solution to a probability question', 'Verifier found an arithmetic slip in step 3'],
  Educator: ['Educator flagged an explanation of ionic bonding for review', 'Educator note on tone in a feedback message'],
};
const TYPE_WEIGHTS = [26, 9, 14, 6, 8, 12, 7, 15, 3];
const TYPE_NAMES = Object.keys(TYPE_SAMPLES);
function pickType() {
  let r = Math.random() * TYPE_WEIGHTS.reduce((x, y) => x + y, 0);
  for (let i = 0; i < TYPE_NAMES.length; i++) if ((r -= TYPE_WEIGHTS[i]) < 0) return TYPE_NAMES[i];
  return TYPE_NAMES[0];
}
const recent = [];
function newChallenge(t = Date.now()) {
  const type = pickType();
  const xs = TYPE_SAMPLES[type];
  const r = Math.random();
  const status = Date.now() - t < 30 * 60_000 ? 'open' : r < 0.5 ? 'resolved' : r < 0.65 ? 'non_issue' : r < 0.75 ? 'duplicate' : r < 0.9 ? 'needs_review' : 'open';
  return { type, summary: xs[Math.floor(Math.random() * xs.length)], status, createdAt: new Date(t).toISOString() };
}
for (let i = 0; i < 12; i++) recent.push(newChallenge(Date.now() - i * rnd(60_000, 400_000)));

export function demoStats() {
  const mins = (Date.now() - started) / 60_000;
  const hour = new Date().getHours();
  const dayFrac = (hour * 60 + new Date().getMinutes()) / 1440;
  // Drift
  if (Math.random() > 0.6) live.subs += Math.random() > 0.15 ? 1 : -1;
  live.aiToday = Math.round(dayFrac * 9 + mins * 0.05);
  if (Math.random() > 0.85) recent.unshift(newChallenge()), recent.splice(12);

  const subsHist = series(30, 1010, 0.0072, 6);
  subsHist[subsHist.length - 1].value = live.subs;
  const usageHist = series(30, 2400, 0.006, 380).map((d) => ({ ...d, value: Math.round(d.value) }));
  const revHist = series(30, 410, 0.008, 90);
  const activeHist = series(30, 900, 0.006, 70).map((d) => ({ ...d, value: Math.round(d.value) }));
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const curve = Math.exp(-((h - 17.5) ** 2) / 10) * 380 + Math.exp(-((h - 10) ** 2) / 6) * 120 + 12;
    return h <= hour ? Math.round(curve * rnd(0.85, 1.15)) : 0;
  });
  const sessionsToday = byHour.reduce((a, b) => a + b, 0);
  const activeToday = Math.round(activeHist.at(-2).value * (0.3 + 0.7 * dayFrac));
  activeHist[activeHist.length - 1].value = activeToday;
  const aiHist = series(30, 7, 0.01, 4).map((d) => ({ ...d, value: Math.round(d.value) }));
  aiHist[aiHist.length - 1].value = live.aiToday;

  const byType = TYPE_NAMES.map((name, i) => {
        seed = (i + 3) * 7919;
        const history = aiHist.map((d) => ({ date: d.date, value: Math.max(0, Math.round((d.value * TYPE_WEIGHTS[i]) / 100 + (srand() - 0.5) * 2)) }));
        return { name, value: history.reduce((t, d) => t + d.value, 0), today: history.at(-1).value, history };
      });
  return {
    accounts: { parents: 1046, students: Math.round(live.subs * 1.18), parentsPaid: 912, parentsTrialing: 71, parentsFree: 38, parentsInactive: 25, studentsPaid: Math.round(live.subs * 1.18) - 112, studentsTrialing: 97, studentsFree: 9, studentsInactive: 6, parentsNewToday: Math.round(dayFrac * 6) + 1, studentsNewToday: Math.round(dayFrac * 9) + 1 },
    subscribers: { total: live.subs, paid: live.subs - 86, trialing: 86, trialsEndingSoon: 19, newToday: Math.round(dayFrac * 14) + 2, newTrialsToday: Math.round(dayFrac * 9) + 1, churnRate: 2.1, history: subsHist },
    active: { live: Math.round(byHour[hour] / 6 + rnd(0, 8)), today: activeToday, todayStudents: Math.round(activeToday * 0.82), todayParents: activeToday - Math.round(activeToday * 0.82), week: 2140, month: 3310, history: activeHist },
    usage: { sessionsToday, minutesToday: Math.round(sessionsToday * 23.4), avgSessionMinutes: 23.4, history: usageHist, byHour },
    revenue: { currency: 'GBP', mrr: Math.round(live.subs * 11.4), today: Math.round(revHist.at(-1).value * dayFrac), month: Math.round(revHist.slice(-new Date().getDate()).reduce((a, b) => a + b.value, 0)), history: revHist },
    ai: {
      total: 1180 + byType.reduce((t, x) => t + x.value, 0),
      today: byType.reduce((t, x) => t + x.today, 0),
      week: byType.reduce((t, x) => t + x.history.slice(-7).reduce((u, d) => u + d.value, 0), 0),
      byType,
      open: recent.filter((c) => !/resolv|non_issue|duplic/.test(c.status)).length + 2,
      history: aiHist.map((d, j) => ({ date: d.date, value: byType.reduce((t, x) => t + x.history[j].value, 0) })),
      recent: recent.slice().sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
    },
  };
}

export function demoInfra() {
  const statuses = ['SUCCESS', 'SUCCESS', 'SUCCESS', 'SUCCESS'];
  const names = ['tutorise-web', 'tutorise-api', 'ai-worker', 'Postgres'];
  return {
    project: 'tutorise (demo)',
    services: names.map((name, i) => ({
      id: 'demo-' + i,
      name,
      status: statuses[i],
      updatedAt: new Date(Date.now() - (i + 1) * 3.7 * 3_600_000).toISOString(),
      cpu: Math.round(rnd(3, 38) * 10) / 10,
      memoryMb: Math.round(rnd(120, 640)),
      cpuSeries: Array.from({ length: 30 }, () => Math.round(rnd(4, 30) * 10) / 10),
    })),
  };
}

const DEMO_MAIL = [
  ['Sarah Patel', 'sarah.patel@example.com', 'Question about the GCSE plan', "Hi there,\n\nMy daughter is in Year 10 and we're thinking about the GCSE plan. Does it cover triple science, or just combined?\n\nThanks,\nSarah"],
  ['Stripe', 'notifications@stripe.example', 'Payout of £2,184.20 is on the way', 'Your payout of £2,184.20 is expected to arrive in your bank account on Friday.'],
  ['James O\'Connor', 'james.oc@example.com', 'Can\'t log in after reset', "Hello,\n\nI reset my password but the app keeps saying my link has expired. Can you help?\n\nJames"],
  ['Railway', 'team@railway.example', 'Deployment succeeded: tutorise-api', 'Your deployment for tutorise-api in production succeeded.'],
  ['Priya Shah', 'priya@schoolpartners.example', 'School partnership enquiry', "Hi,\n\nI'm head of maths at a secondary school in Leeds. We'd love to trial Tutorise with a Year 11 class. Do you offer school licences?\n\nBest,\nPriya"],
  ['Tom Wright', 'tom.wright@example.com', 'Love the AI challenges!', "Just wanted to say my son actually asks to do the AI maths challenges now. Thank you!\n\nTom"],
];
const demoMessages = DEMO_MAIL.map(([name, address, subject, text], i) => ({
  uid: 1000 - i,
  from: { name, address },
  subject,
  date: new Date(Date.now() - (i * 2.4 + 0.3) * 3_600_000).toISOString(),
  seen: i > 2,
  answered: false,
  preview: text.replace(/\s+/g, ' ').slice(0, 140),
  text,
  messageId: `<demo-${i}@tutorise.local>`,
}));
export const demoMail = {
  list: () => demoMessages.map(({ text, ...m }) => m),
  get: (uid) => demoMessages.find((m) => m.uid === Number(uid)),
  markSeen: (uid) => { const m = demoMessages.find((x) => x.uid === Number(uid)); if (m) m.seen = true; },
  markAnswered: (uid) => { const m = demoMessages.find((x) => x.uid === Number(uid)); if (m) m.answered = true; },
};

export function demoCosts() {
  const day = new Date().getUTCDate();
  const daysInMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate();
  const history = series(31, 9, 0.004, 3).map((d) => ({ ...d, value: Math.round(d.value * 100) / 100 }));
  const mtdA = Math.round(history.slice(-day).reduce((t, d) => t + d.value * 0.72, 0) * 100) / 100;
  const mtdO = Math.round(history.slice(-day).reduce((t, d) => t + d.value * 0.28, 0) * 100) / 100;
  const rate = history.slice(-8, -1).reduce((t, d) => t + d.value, 0) / 7;
  const projected = Math.round((mtdA + mtdO + rate * (daysInMonth - day + 0.5)) * 100) / 100;
  return {
    currency: 'GBP', usdToGbp: 0.79, mtd: Math.round((mtdA + mtdO) * 100) / 100, projected, dailyRate: Math.round(rate * 100) / 100,
    byProvider: [{ name: 'Anthropic', mtd: mtdA, projected: Math.round(projected * 0.72 * 100) / 100 }, { name: 'OpenAI', mtd: mtdO, projected: Math.round(projected * 0.28 * 100) / 100 }],
    history, dataThrough: new Date(Date.now() - 3 * 3_600_000).toISOString(), errors: [],
  };
}
