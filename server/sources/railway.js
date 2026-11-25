// Railway public GraphQL API: services, latest deployment status and
// (best-effort) CPU / memory metrics for the configured project.
const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

// Railway has two kinds of token, sent differently: account/workspace tokens as
// "Authorization: Bearer", project tokens in a "Project-Access-Token" header.
async function rawGql(token, type, query, variables = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (type === 'project') headers['Project-Access-Token'] = token;
  else headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) {
    const e = new Error('Railway: ' + (json.errors?.[0]?.message || `${res.status} ${res.statusText}`));
    e.notAuthorized = res.status === 401 || res.status === 403 || /not authori[sz]ed|unauthori[sz]ed|forbidden/i.test(json.errors?.[0]?.message || '');
    throw e;
  }
  return json.data;
}

/**
 * Work out how to use the token, whatever the "Token type" setting says: try the
 * configured type first, then the other. A project token also tells us its
 * project and environment, so those fields can be left blank.
 * Returns { type, projectId, environmentId }.
 */
const authCache = new Map();
async function resolveAuth(cfg) {
  const key = `${cfg.token}|${cfg.projectId}|${cfg.environmentId}`;
  const hit = authCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.auth;
  const asProject = async () => {
    const d = await rawGql(cfg.token, 'project', 'query { projectToken { projectId environmentId } }');
    return { type: 'project', projectId: d.projectToken.projectId, environmentId: d.projectToken.environmentId };
  };
  const asAccount = async () => {
    if (!cfg.projectId) { const e = new Error('Enter the project ID (Railway → your project → Settings → General).'); e.needsProject = true; throw e; }
    await rawGql(cfg.token, 'account', 'query($id: String!) { project(id: $id) { id } }', { id: cfg.projectId });
    return { type: 'account', projectId: cfg.projectId, environmentId: cfg.environmentId };
  };
  const order = cfg.tokenType === 'project' ? [asProject, asAccount] : [asAccount, asProject];
  const errors = [];
  for (const attempt of order) {
    try {
      const auth = await attempt();
      if (auth.type === 'project' && cfg.projectId && cfg.projectId !== auth.projectId) {
        throw new Error(`This project token belongs to a different project (${auth.projectId}) from the Project ID entered (${cfg.projectId}). Clear the Project ID or use a token from the right project.`);
      }
      authCache.set(key, { at: Date.now(), auth });
      return auth;
    } catch (e) {
      if (e.needsProject) { errors.push(e); continue; }
      if (!e.notAuthorized) throw e; // network or other error: report it as is
      errors.push(e);
    }
  }
  const needsProject = errors.find((e) => e.needsProject);
  if (needsProject) throw new Error('Railway didn’t accept this as a project token. If it’s an account or workspace token, ' + needsProject.message.charAt(0).toLowerCase() + needsProject.message.slice(1));
  throw new Error('Railway: not authorised. It rejected this token both as an account/workspace token and as a project token. Check that: the token was copied in full and hasn’t been deleted; the Project ID is the project’s ID (Project → Settings → General), not a service or environment ID; and an account token was created in the workspace that owns the project (or with “No workspace” for personal projects).');
}

async function gql(cfg, query, variables = {}) {
  const auth = await resolveAuth(cfg);
  return rawGql(cfg.token, auth.type, query, variables);
}

export const railwayConfigured = (cfg) => !!cfg.token;

export async function fetchRailway(cfgIn) {
  const auth = await resolveAuth(cfgIn);
  const cfg = { ...cfgIn, projectId: auth.projectId, environmentId: cfgIn.environmentId || auth.environmentId || '' };
  const data = await gql(cfg, `query($id: String!) {
    project(id: $id) {
      name
      environments { edges { node { id name } } }
      services { edges { node { id name } } }
    }
  }`, { id: cfg.projectId });
  const project = data.project;
  const envs = project.environments.edges.map((e) => e.node);
  const env = envs.find((e) => e.id === cfg.environmentId) || envs.find((e) => e.name === 'production') || envs[0];
  const services = project.services.edges.map((e) => e.node);
  if (!services.length) return { project: project.name, environment: env?.name, services: [] };

  // One request with an aliased deployments query per service.
  const parts = services.map((s, i) => `s${i}: deployments(first: 1, input: { projectId: $p, serviceId: "${s.id}", environmentId: $e }) { edges { node { id status createdAt staticUrl } } }`);
  const deps = await gql(cfg, `query($p: String!, $e: String!) { ${parts.join('\n')} }`, { p: cfg.projectId, e: env.id });

  const start = new Date(Date.now() - 60 * 60_000).toISOString();
  const metrics = await Promise.all(services.map((s) =>
    gql(cfg, `query($p: String!, $s: String!, $e: String!, $start: DateTime!) {
      metrics(projectId: $p, serviceId: $s, environmentId: $e, startDate: $start, measurements: [CPU_USAGE, MEMORY_USAGE_GB], sampleRateSeconds: 120) { measurement values { ts value } }
    }`, { p: cfg.projectId, s: s.id, e: env.id, start }).then((d) => d.metrics).catch(() => null)));

  return {
    project: project.name,
    environment: env?.name,
    services: services.map((s, i) => {
      const d = deps[`s${i}`]?.edges?.[0]?.node;
      const m = metrics[i] || [];
      const cpu = m.find((x) => x.measurement === 'CPU_USAGE')?.values || [];
      const mem = m.find((x) => x.measurement === 'MEMORY_USAGE_GB')?.values || [];
      return {
        id: s.id,
        name: s.name,
        status: d?.status || 'NO_DEPLOYMENT',
        updatedAt: d?.createdAt,
        url: d?.staticUrl ? `https://${d.staticUrl}` : undefined,
        // Railway reports CPU in vCPU units; show as % of one vCPU.
        cpu: cpu.length ? Math.round(cpu.at(-1).value * 1000) / 10 : undefined,
        memoryMb: mem.length ? Math.round(mem.at(-1).value * 1024) : undefined,
        cpuSeries: cpu.map((v) => Math.round(v.value * 1000) / 10),
      };
    }),
  };
}

export async function testRailway(cfg) {
  const auth = await resolveAuth(cfg);
  const r = await fetchRailway(cfg);
  const kind = auth.type === 'project' ? 'project token' : 'account/workspace token';
  return `Connected with ${kind === 'project token' ? 'a' : 'an'} ${kind} to “${r.project}” (${r.environment}): ${r.services.length} service${r.services.length === 1 ? '' : 's'}`;
}

/**
 * Find the Postgres connection string in the Railway project: looks through each
 * service's variables for DATABASE_PUBLIC_URL (reachable from outside Railway).
 * Returns { url, service } — the URL stays on the server.
 */
export async function findDatabaseUrl(cfgIn) {
  const auth = await resolveAuth(cfgIn);
  const cfg = { ...cfgIn, projectId: auth.projectId, environmentId: cfgIn.environmentId || auth.environmentId || '' };
  const data = await gql(cfg, `query($id: String!) {
    project(id: $id) { environments { edges { node { id name } } } services { edges { node { id name } } } }
  }`, { id: cfg.projectId });
  const envs = data.project.environments.edges.map((e) => e.node);
  const env = envs.find((e) => e.id === cfg.environmentId) || envs.find((e) => e.name === 'production') || envs[0];
  const services = data.project.services.edges.map((e) => e.node);
  // Check likely database services first.
  services.sort((a, b) => Number(/postgres|db|database/i.test(b.name)) - Number(/postgres|db|database/i.test(a.name)));
  const checked = [];
  let internalHost = null, unreadable = [], nonPostgres = null;
  for (const s of services) {
    let vars;
    try {
      vars = (await gql(cfg, `query($p: String!, $e: String!, $s: String!) { variables(projectId: $p, environmentId: $e, serviceId: $s) }`,
        { p: cfg.projectId, e: env.id, s: s.id })).variables || {};
    } catch { unreadable.push(s.name); continue; }
    checked.push(s.name);
    if (vars.DATABASE_PUBLIC_URL) return { url: vars.DATABASE_PUBLIC_URL, service: s.name, environment: env.name };
    // Postgres service with the TCP proxy on but no DATABASE_PUBLIC_URL variable: build it.
    if (vars.RAILWAY_TCP_PROXY_DOMAIN && vars.RAILWAY_TCP_PROXY_PORT && (vars.PGPASSWORD || vars.POSTGRES_PASSWORD)) {
      const user = encodeURIComponent(vars.PGUSER || vars.POSTGRES_USER || 'postgres');
      const pass = encodeURIComponent(vars.PGPASSWORD || vars.POSTGRES_PASSWORD);
      const db = encodeURIComponent(vars.PGDATABASE || vars.POSTGRES_DB || 'railway');
      return { url: `postgresql://${user}:${pass}@${vars.RAILWAY_TCP_PROXY_DOMAIN}:${vars.RAILWAY_TCP_PROXY_PORT}/${db}`, service: s.name, environment: env.name };
    }
    const dbUrl = vars.DATABASE_URL || vars.POSTGRES_URL || vars.DB_URL || '';
    const m = /^postgres(ql)?:\/\//i.test(dbUrl) && /@([a-z0-9-]+)\.railway\.internal/i.exec(dbUrl);
    if (m) { internalHost ||= m[1]; }
    // A Postgres hosted elsewhere (Neon, Supabase, RDS…) is reachable directly.
    else if (/^postgres(ql)?:\/\//i.test(dbUrl) && !/\.railway\.internal|@(localhost|127\.0\.0\.1)[:/]/i.test(dbUrl)) {
      return { url: dbUrl, service: s.name, environment: env.name, external: true };
    }
    // SQLite file (e.g. Prisma "file:./dev.db") or another non-Postgres database.
    else if (dbUrl && !nonPostgres) nonPostgres = { service: s.name, kind: /^(file:|sqlite)/i.test(dbUrl) || /\.(db|sqlite3?)$/i.test(dbUrl) ? 'sqlite' : (dbUrl.split(':')[0] || 'unknown') };
  }
  if (!internalHost && nonPostgres) {
    throw new Error(nonPostgres.kind === 'sqlite'
      ? `“${nonPostgres.service}” stores its data in a SQLite file on its own volume, not in a Postgres database, so the dashboard can't connect to it directly. Use the “Tutorise stats API endpoint” source instead: add a small /api/admin/stats route to ${nonPostgres.service} (see docs/tutora-stats-endpoint-prompt.md for a ready-made prompt).`
      : `“${nonPostgres.service}” uses a ${nonPostgres.kind} database, which the dashboard can't query directly. Use the “Tutorise stats API endpoint” source instead (see docs/tutora-stats-endpoint-prompt.md).`);
  }
  const summary = `Checked ${[...checked, ...unreadable.map((n) => n + ' (couldn’t read variables)')].join(', ')} in “${env.name}”.`;
  if (internalHost) {
    // Railway's private hostname is the database service's name.
    const db = services.find((s) => s.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') === internalHost.toLowerCase())
      || services.find((s) => s.name.toLowerCase().includes(internalHost.toLowerCase().split('-')[0]));
    const name = db ? `“${db.name}”` : `the database service (internal host “${internalHost}”)`;
    if (db && unreadable.includes(db.name)) {
      throw new Error(`Your database is ${name}, but your Railway token isn't allowed to read its settings. In Settings → Railway, use an account token (Railway → Account Settings → Tokens) instead of a project token, then press Fetch again. If it still fails, make sure ${name} has a TCP Proxy (Settings → Networking → Public Networking). ${summary}`);
    }
    throw new Error(`Your database is ${name}, and it isn't reachable from outside Railway yet. In Railway, click ${name} (the database, not your app) → Settings → Networking → Public Networking → add a TCP Proxy on port 5432. Then press Fetch again. ${summary}`);
  }
  throw new Error(`Couldn’t find a Postgres database URL. ${summary}`);
}
