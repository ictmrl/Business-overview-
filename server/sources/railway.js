// Railway public GraphQL API: services, latest deployment status and
// (best-effort) CPU / memory metrics for the configured project.
const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

async function gql(cfg, query, variables = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.tokenType === 'project') headers['Project-Access-Token'] = cfg.token;
  else headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) throw new Error('Railway: ' + (json.errors?.[0]?.message || `${res.status} ${res.statusText}`));
  return json.data;
}

export const railwayConfigured = (cfg) => !!(cfg.token && cfg.projectId);

export async function fetchRailway(cfg) {
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
  const r = await fetchRailway(cfg);
  return `Connected to “${r.project}” (${r.environment}) — ${r.services.length} services`;
}
