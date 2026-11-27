/*
 * Account linkage: union-find over shared register attributes under a policy.
 *
 *   strong1 : link a pair if it shares any one STRONG attribute
 *   weak2   : link a pair if it shares one strong OR two weak attributes
 *   weak1   : link a pair if it shares any attribute at all
 *
 * Output keeps every evidence edge (also pairs that the policy did NOT link),
 * so a case file can show "these two share a branch, but that is weak".
 */

export const LINKAGE_POLICIES = {
  strong1: { id: 'strong1', label: 'Strict: one shared strong attribute', minStrong: 1, minWeak: Infinity, minAny: Infinity },
  weak2: { id: 'weak2', label: 'Default: one strong, or two weak', minStrong: 1, minWeak: 2, minAny: Infinity },
  weak1: { id: 'weak1', label: 'Loose: any shared attribute', minStrong: 1, minWeak: 1, minAny: 1 },
};

function pairLinked(policy, strongN, weakN) {
  return strongN >= policy.minStrong || weakN >= policy.minWeak || strongN + weakN >= policy.minAny;
}

export function buildLinkage(register, policyId) {
  const policy = LINKAGE_POLICIES[policyId];
  if (!policy) throw new Error(`Unknown linkage policy: ${policyId}`);
  const rows = register.rows;
  const strengthOf = {};
  for (const a of register.schema) strengthOf[a.key] = a.strength;

  // pair -> shared attributes
  const pairs = new Map();
  for (const a of register.schema) {
    const groups = new Map();
    for (const r of rows) {
      const v = r.attributes[a.key];
      if (v == null) continue;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(r.acct);
    }
    for (const [value, accts] of groups) {
      for (let i = 0; i < accts.length; i++) {
        for (let j = i + 1; j < accts.length; j++) {
          const k = `${accts[i]}|${accts[j]}`;
          if (!pairs.has(k)) pairs.set(k, { a: accts[i], b: accts[j], shared: [] });
          pairs.get(k).shared.push({ key: a.key, strength: a.strength, value });
        }
      }
    }
  }

  const parent = {};
  for (const r of rows) parent[r.acct] = r.acct;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (x, y) => {
    const rx = find(x), ry = find(y);
    if (rx === ry) return;
    if (rx < ry) parent[ry] = rx; else parent[rx] = ry;
  };

  const edges = [...pairs.values()].sort((p, q) => (p.a + p.b < q.a + q.b ? -1 : 1));
  for (const e of edges) {
    const s = e.shared.filter((x) => x.strength === 'strong').length;
    const w = e.shared.length - s;
    e.linked = pairLinked(policy, s, w);
    if (e.linked) union(e.a, e.b);
  }

  const members = new Map();
  for (const r of rows) {
    const root = find(r.acct);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(r.acct);
  }
  const clusterOf = {};
  const clusters = [];
  for (const [root, accts] of members) {
    accts.sort();
    const id = `CL-${accts[0]}`;
    for (const a of accts) clusterOf[a] = id;
    if (accts.length > 1) {
      clusters.push({ id, accounts: accts, edges: [] });
    }
  }
  // attach linked evidence edges to their clusters (second pass: clusterOf is complete)
  const byId = new Map(clusters.map((c) => [c.id, c]));
  for (const e of edges) if (e.linked) byId.get(clusterOf[e.a]).edges.push({ a: e.a, b: e.b, shared: e.shared });
  clusters.sort((x, y) => (x.id < y.id ? -1 : 1));
  return {
    policy: policy.id,
    clusters,
    clusterOf,
    singletonCount: rows.length - clusters.reduce((n, c) => n + c.accounts.length, 0),
    edges: edges.map((e) => ({ a: e.a, b: e.b, shared: e.shared, linked: e.linked })),
  };
}
