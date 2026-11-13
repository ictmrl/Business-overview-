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

const live = { subs: 1284, active: 0, sessions: 0, revenueToday: 0, ai: 18420, aiToday: 0 };
const started = Date.now();

const SUBJECTS = ['Maths', 'English', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'History', 'French'];
const LEVELS = ['KS2', 'KS3', 'GCSE', 'A-Level'];
const TITLES = {
  Maths: ['Quadratic equations sprint', 'Simultaneous equations', 'Probability trees', 'Circle theorems', 'Differentiation basics'],
  English: ['Macbeth: themes of ambition', 'Persuasive writing drill', 'Poetry comparison', 'Inspector Calls quotes'],
  Physics: ['Forces & motion', 'Electric circuits', 'Waves & the EM spectrum', 'Specific heat capacity'],
  Chemistry: ['Balancing equations', 'Rates of reaction', 'Ionic bonding quiz', 'Electrolysis'],
  Biology: ['Cell structure', 'Photosynthesis', 'Homeostasis', 'Genetics & inheritance'],
  'Computer Science': ['Binary & hex', 'Python loops', 'Sorting algorithms', 'Boolean logic'],
  History: ['Causes of WW1', 'Norman conquest', 'Cold War timeline'],
  French: ['Past tense verbs', 'Vocabulary: school life', 'Listening practice'],
};
const NAMES = ['Amelia', 'Oliver', 'Isla', 'George', 'Ava', 'Noah', 'Freya', 'Leo', 'Mia', 'Arthur', 'Sophia', 'Harry'];
const recent = [];
function newChallenge(t = Date.now()) {
  const subject = SUBJECTS[Math.floor(Math.random() ** 1.6 * SUBJECTS.length)];
  const list = TITLES[subject];
  const completed = Math.random() > 0.22;
  return {
    title: list[Math.floor(Math.random() * list.length)],
    subject,
    level: LEVELS[Math.floor(Math.random() * LEVELS.length)],
    student: NAMES[Math.floor(Math.random() * NAMES.length)],
    score: completed ? Math.round(rnd(48, 100)) : null,
    completed,
    createdAt: new Date(t).toISOString(),
  };
}
for (let i = 0; i < 12; i++) recent.push(newChallenge(Date.now() - i * rnd(60_000, 400_000)));

export function demoStats() {
  const mins = (Date.now() - started) / 60_000;
  const hour = new Date().getHours();
  const dayFrac = (hour * 60 + new Date().getMinutes()) / 1440;
  // Drift
  if (Math.random() > 0.6) live.subs += Math.random() > 0.15 ? 1 : -1;
  live.aiToday = Math.round(dayFrac * 640 + mins * 0.8);
  if (Math.random() > 0.4) recent.unshift(newChallenge()), recent.splice(12);

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
  const counts = {};
  for (const s of SUBJECTS) counts[s] = 0;
  SUBJECTS.forEach((s, i) => (counts[s] = Math.round(4200 / (i + 1.3) + rnd(0, 120))));
  const levels = { KS2: 1820, KS3: 3940, GCSE: 8610, 'A-Level': 4050 };

  return {
    accounts: { parents: 1046, students: Math.round(live.subs * 1.18), parentsPaid: 912, parentsTrialing: 71, studentsPaid: Math.round(live.subs * 1.18) - 112, studentsTrialing: 97, parentsNewToday: Math.round(dayFrac * 6) + 1, studentsNewToday: Math.round(dayFrac * 9) + 1 },
    subscribers: { total: live.subs, paid: live.subs - 86, trialing: 86, trialsEndingSoon: 19, newToday: Math.round(dayFrac * 14) + 2, newTrialsToday: Math.round(dayFrac * 9) + 1, churnRate: 2.1, history: subsHist },
    active: { live: Math.round(byHour[hour] / 6 + rnd(0, 8)), today: activeToday, week: 2140, month: 3310, history: activeHist },
    usage: { sessionsToday, minutesToday: Math.round(sessionsToday * 23.4), avgSessionMinutes: 23.4, history: usageHist, byHour },
    revenue: { currency: 'GBP', mrr: Math.round(live.subs * 11.4), today: Math.round(revHist.at(-1).value * dayFrac), month: Math.round(revHist.slice(-new Date().getDate()).reduce((a, b) => a + b.value, 0)), history: revHist },
    ai: {
      total: live.ai + live.aiToday,
      today: live.aiToday,
      completionRate: 78.4,
      avgScore: 74.2,
      bySubject: Object.entries(counts).map(([name, value]) => ({ name, value })),
      byLevel: Object.entries(levels).map(([name, value]) => ({ name, value })),
      recent: recent.slice(),
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
