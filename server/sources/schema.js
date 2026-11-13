// Schema auto-detection for direct Postgres mode. Reads table/column names
// from information_schema (plus distinct values of role/status-like columns),
// works out where parents, students, subscriptions and trials live, and
// generates the dashboard's SQL queries. Handles snake_case and Prisma-style
// quoted camelCase tables alike.

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const col = (a, name) => (a ? `${a}.` : '') + qi(name);
const ql = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const C = {
  id: ['id'],
  created: ['createdat', 'insertedat', 'created', 'datecreated', 'signupat', 'registeredat', 'joinedat'],
  canceled: ['canceledat', 'cancelledat', 'endedat', 'cancelat'],
  trialEnd: ['trialend', 'trialendsat', 'trialendat', 'trialenddate', 'trialexpiresat', 'trialexpiry'],
  status: ['status', 'subscriptionstatus', 'planstatus', 'billingstatus', 'stripestatus', 'stripesubscriptionstatus', 'state'],
  userStatus: ['subscriptionstatus', 'planstatus', 'billingstatus', 'stripestatus', 'stripesubscriptionstatus', 'accountstatus'],
  role: ['role', 'type', 'usertype', 'accounttype', 'kind', 'userrole'],
  parentFk: ['parentid', 'userid', 'guardianid', 'accountid', 'ownerid', 'familyid', 'customerid', 'parentuserid'],
  studentFk: ['studentid', 'childid', 'learnerid', 'pupilid', 'kidid', 'childprofileid', 'studentprofileid'],
};
const pick = (cols, cands) => cands.map((c) => cols.find((x) => norm(x) === c)).find(Boolean);

const PARENT_TABLES = ['parent', 'parents', 'guardian', 'guardians', 'family', 'families'];
const STUDENT_TABLES = ['student', 'students', 'child', 'children', 'kid', 'kids', 'learner', 'learners', 'pupil', 'pupils', 'childprofile', 'childprofiles', 'studentprofile', 'studentprofiles'];
const USER_TABLES = ['user', 'users', 'account', 'accounts', 'profile', 'profiles', 'member', 'members'];
const SUB_TABLES = ['subscription', 'subscriptions', 'usersubscription', 'usersubscriptions', 'plan', 'plans', 'membership', 'memberships'];

const isParentVal = (v) => /parent|guardian|family|carer/i.test(v);
const isStudentVal = (v) => /student|child|learner|pupil|kid/i.test(v);
const isTrialVal = (v) => /trial/i.test(v);
const isPaidVal = (v) => /^(active|paid|past_?due|subscribed|premium|pro)$/i.test(v);
const isIgnoredVal = (v) => /incomplete/i.test(v);

export async function inspectSchema(pool) {
  const { rows } = await pool.query(`
    SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
  const tables = {};
  for (const r of rows) (tables[r.table_name] ||= []).push({ name: r.column_name, type: r.data_type });
  // Distinct values for role- and status-like columns (only short text/enum columns).
  const values = {};
  const wanted = new Set([...C.role, ...C.status]);
  await Promise.all(Object.entries(tables).flatMap(([t, cols]) => cols
    .filter((c) => wanted.has(norm(c.name)) && /char|text|USER-DEFINED/i.test(c.type))
    .map(async (c) => {
      try {
        const r = await pool.query(`SELECT DISTINCT ${qi(c.name)}::text AS v FROM ${qi(t)} WHERE ${qi(c.name)} IS NOT NULL LIMIT 25`);
        values[`${t}.${c.name}`] = r.rows.map((x) => x.v);
      } catch { /* ignore */ }
    })));
  return { tables, values };
}

const findTable = (tables, names) => {
  const keys = Object.keys(tables);
  for (const n of names) { const t = keys.find((k) => norm(k) === n); if (t) return t; }
  return null;
};

/** Work out the mapping and generate queries. Returns { queries, notes, mapping }. */
export function detectMapping({ tables, values }) {
  const notes = [];
  const cols = (t) => (tables[t] || []).map((c) => c.name);
  const userT = findTable(tables, USER_TABLES);

  // ---- Parents
  let parent = null;
  const pt = findTable(tables, PARENT_TABLES);
  if (pt) parent = { table: pt, where: () => 'TRUE' };
  else if (userT) {
    const roleCol = pick(cols(userT), C.role);
    const vals = roleCol ? values[`${userT}.${roleCol}`] || [] : [];
    const pv = vals.filter(isParentVal);
    if (pv.length) parent = { table: userT, where: (a) => `${col(a, roleCol)}::text IN (${pv.map(ql).join(', ')})`, label: `${roleCol} in ${pv.join('/')}` };
  }

  // ---- Students
  let student = null;
  const st = findTable(tables, STUDENT_TABLES);
  if (st) student = { table: st, where: () => 'TRUE' };
  else if (userT) {
    const roleCol = pick(cols(userT), C.role);
    const vals = roleCol ? values[`${userT}.${roleCol}`] || [] : [];
    const sv = vals.filter(isStudentVal);
    if (sv.length) student = { table: userT, where: (a) => `${col(a, roleCol)}::text IN (${sv.map(ql).join(', ')})`, label: `${roleCol} in ${sv.join('/')}` };
  }
  // No explicit parent marker, but there is a separate students table → the user table holds the parents.
  if (!parent && userT && student && student.table !== userT) {
    parent = { table: userT, where: () => 'TRUE' };
    notes.push(`Treating every row in “${userT}” as a parent (students live in “${student.table}”).`);
  }
  if (student) student.parentFk = pick(cols(student.table), C.parentFk.filter((c) => !(student.table === userT && c === 'userid')));
  for (const x of [parent, student]) if (x) { x.id = pick(cols(x.table), C.id); x.created = pick(cols(x.table), C.created); }

  // ---- Subscriptions / trials
  let sub = null;
  const subT = findTable(tables, SUB_TABLES) || Object.keys(tables).find((t) => /subscri/i.test(t));
  if (subT) {
    const c = cols(subT);
    const studentFk = pick(c, C.studentFk), parentFk = pick(c, C.parentFk);
    sub = {
      table: subT, status: pick(c, C.status), trialEnd: pick(c, C.trialEnd), created: pick(c, C.created), canceled: pick(c, C.canceled),
      owner: studentFk && student ? 'student' : parentFk && parent ? 'parent' : null,
      ownerCol: studentFk && student ? studentFk : parentFk,
    };
  } else {
    // Status stored on the parent (or user) row itself.
    for (const who of [parent, student]) {
      if (!who) continue;
      const c = cols(who.table);
      const status = pick(c, C.userStatus) || (pick(c, ['status']) && (values[`${who.table}.${pick(c, ['status'])}`] || []).some((v) => isTrialVal(v) || isPaidVal(v)) ? pick(c, ['status']) : null);
      const trialEnd = pick(c, C.trialEnd);
      if (status || trialEnd) {
        sub = { table: who.table, status, trialEnd, created: who.created, canceled: pick(c, C.canceled), owner: who === parent ? 'parent' : 'student', ownerCol: who.id, onSelf: true, selfWhere: who.where };
        break;
      }
    }
  }

  const q = {};
  if (parent) {
    q.parentsTotal = `SELECT count(*)::int AS value FROM ${qi(parent.table)} WHERE ${parent.where()}`;
    if (parent.created) q.parentsNewToday = `SELECT count(*)::int AS value FROM ${qi(parent.table)} WHERE ${parent.where()} AND ${qi(parent.created)} >= date_trunc('day', now())`;
  } else notes.push('Could not find parents: no parent/guardian table, and no role column with a “parent” value.');
  if (student) {
    q.studentsTotal = `SELECT count(*)::int AS value FROM ${qi(student.table)} WHERE ${student.where()}`;
    if (student.created) q.studentsNewToday = `SELECT count(*)::int AS value FROM ${qi(student.table)} WHERE ${student.where()} AND ${qi(student.created)} >= date_trunc('day', now())`;
  } else notes.push('Could not find students: no students/children table, and no role column with a “student” value.');

  if (sub) {
    const statusVals = sub.status ? values[`${sub.table}.${sub.status}`] || [] : [];
    const trialVals = statusVals.filter(isTrialVal), paidVals = statusVals.filter(isPaidVal), ignored = statusVals.filter(isIgnoredVal);
    const S = qi(sub.table);
    const base = (a) => (sub.onSelf ? sub.selfWhere(a) : 'TRUE');
    const inList = (a, c, vals) => `${col(a, c)}::text IN (${vals.map(ql).join(', ')})`;
    let trialCond = null, paidCond = null; // functions of alias
    if (sub.status && (trialVals.length || paidVals.length)) {
      if (trialVals.length) {
        trialCond = (a) => inList(a, sub.status, trialVals);
        paidCond = paidVals.length ? (a) => inList(a, sub.status, paidVals) : null;
      } else if (sub.trialEnd) { // e.g. Stripe-style: status 'active' during the trial, trial_end in the future
        trialCond = (a) => `(${inList(a, sub.status, paidVals)} AND ${col(a, sub.trialEnd)} > now())`;
        paidCond = (a) => `(${inList(a, sub.status, paidVals)} AND (${col(a, sub.trialEnd)} IS NULL OR ${col(a, sub.trialEnd)} <= now()))`;
      } else paidCond = (a) => inList(a, sub.status, paidVals);
      notes.push(`Subscription status is “${sub.table}.${sub.status}”: paid = ${paidVals.join(', ') || '—'}; trial = ${trialVals.join(', ') || (sub.trialEnd ? `${sub.trialEnd} in the future` : 'none found')}.`);
    } else if (sub.trialEnd) {
      trialCond = (a) => `${col(a, sub.trialEnd)} > now()`;
      notes.push(`No status values recognised; trials = “${sub.table}.${sub.trialEnd}” in the future. Paid customers can't be told apart.`);
    } else notes.push(`Found “${sub.table}” but couldn't tell which column marks trial vs paid.`);
    const live = (a) => [paidCond, trialCond].filter(Boolean).map((f) => f(a)).join(' OR ') || 'TRUE';
    const W = (extra) => `SELECT count(*)::int AS value FROM ${S} WHERE ${base()} AND ${extra}`;

    if (paidCond) q.subscribersPaid = W(paidCond());
    if (trialCond) q.subscribersTrialing = W(trialCond());
    q.subscribersTotal = '';
    if (sub.created) {
      const today = `${qi(sub.created)} >= date_trunc('day', now())`;
      q.subscribersNewToday = W(`(${live()}) AND ${today}`);
      if (trialCond) q.subscribersNewTrialsToday = W(`${trialCond()} AND ${today}`);
      const notIgnored = ignored.length && sub.status ? ` AND ${col('s', sub.status)}::text NOT IN (${ignored.map(ql).join(', ')})` : '';
      // With a cancel date we can rebuild history; otherwise count rows that are live now, by signup date.
      const alive = sub.canceled ? `(${col('s', sub.canceled)} IS NULL OR ${col('s', sub.canceled)} >= d + interval '1 day')` : `(${live('s')})`;
      q.subscribersHistory = `SELECT to_char(d, 'YYYY-MM-DD') AS date, (SELECT count(*) FROM ${S} s WHERE ${base('s')}${notIgnored} AND ${col('s', sub.created)} < d + interval '1 day' AND ${alive})::int AS value FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`;
    } else notes.push(`No created-at column on “${sub.table}”, so subscriber history comes from the dashboard's own daily snapshots.`);
    if (sub.trialEnd && trialCond) q.trialsEndingSoon = W(`${trialCond()} AND ${qi(sub.trialEnd)} BETWEEN now() AND now() + interval '3 days'`);

    // ---- Parents / students by paid vs trial
    if (sub.ownerCol && sub.owner) {
      const oc = qi(sub.ownerCol);
      const set = (cond) => `(SELECT ${oc} FROM ${S} WHERE ${base()} AND ${cond()} AND ${oc} IS NOT NULL)`;
      const paidSet = paidCond ? set(paidCond) : null, trialSet = trialCond ? set(trialCond) : null;
      const cnt = (who, expr, inSet, notSet) => `SELECT count(*)::int AS value FROM ${qi(who.table)} WHERE ${who.where()} AND ${expr} IN ${inSet}${notSet ? ` AND ${expr} NOT IN ${notSet}` : ''}`;
      const owner = sub.owner === 'parent' ? parent : student;
      const ownerKey = sub.owner === 'parent' ? 'parents' : 'students';
      if (owner?.id) {
        if (paidSet) q[`${ownerKey}Paid`] = cnt(owner, qi(owner.id), paidSet);
        if (trialSet) q[`${ownerKey}Trialing`] = cnt(owner, qi(owner.id), trialSet, paidSet);
      }
      if (parent?.id && student?.id && student.parentFk) {
        if (sub.owner === 'parent') { // students count under their parent's plan
          if (paidSet) q.studentsPaid = cnt(student, qi(student.parentFk), paidSet);
          if (trialSet) q.studentsTrialing = cnt(student, qi(student.parentFk), trialSet, paidSet);
        } else { // a parent is paid if any child is paid, trialing if any child is on trial (and none paid)
          const kids = (s2) => `(SELECT ${qi(student.parentFk)} FROM ${qi(student.table)} WHERE ${student.where()} AND ${qi(student.id)} IN ${s2} AND ${qi(student.parentFk)} IS NOT NULL)`;
          if (paidSet) q.parentsPaid = cnt(parent, qi(parent.id), kids(paidSet));
          if (trialSet) q.parentsTrialing = cnt(parent, qi(parent.id), kids(trialSet), paidSet ? kids(paidSet) : null);
        }
      } else if (parent && student) notes.push(`Couldn't find which column links students to parents, so ${sub.owner === 'parent' ? 'students' : 'parents'} aren't split by paid/trial.`);
      notes.push(`Subscriptions belong to ${sub.owner === 'student' ? 'each student' : 'the parent'} (“${sub.table}.${sub.ownerCol}”).`);
    }
  } else notes.push('No subscriptions table or subscription-status column found.');

  return {
    queries: q,
    notes,
    mapping: {
      parents: parent && `${parent.table}${parent.label ? ` (${parent.label})` : ''}`,
      students: student && `${student.table}${student.label ? ` (${student.label})` : ''}${student.parentFk ? ` · linked to parent by ${student.parentFk}` : ''}`,
      subscriptions: sub && `${sub.table}${sub.status ? ` · status: ${sub.status}` : ''}${sub.trialEnd ? ` · trial end: ${sub.trialEnd}` : ''}`,
    },
  };
}

/** Plain-text schema summary the owner can share (names and role/status values only, no customer data). */
export function schemaReport({ tables, values }) {
  return Object.entries(tables).map(([t, cols]) => `${t}: ${cols.map((c) => {
    const v = values[`${t}.${c.name}`];
    return c.name + (v ? ` [${v.slice(0, 12).join(' | ')}]` : '');
  }).join(', ')}`).join('\n');
}
