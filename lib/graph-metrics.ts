import type { Node, Link } from '@/lib/data'

export function computeWeightedDegree(orgId: string, links: Link[]): number {
  return links
    .filter(l => l.source === orgId || l.target === orgId)
    .reduce((sum, l) => sum + l.weight, 0)
}

export function computeCloseness(orgId: string, nodes: Node[], links: Link[]): number {
  // Simple BFS for shortest paths (unweighted)
  const orgIds = nodes.filter(n => n.type === 'org').map(n => n.id)
  const visited = new Set<string>()
  const queue: { id: string; dist: number }[] = [{ id: orgId, dist: 0 }]
  let totalDist = 0
  let reachable = 0

  while (queue.length) {
    const { id, dist } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    if (id !== orgId && orgIds.includes(id)) {
      totalDist += dist
      reachable += 1
    }
    links.forEach(l => {
      if (l.source === id && !visited.has(l.target)) queue.push({ id: l.target, dist: dist + 1 })
      if (l.target === id && !visited.has(l.source)) queue.push({ id: l.source, dist: dist + 1 })
    })
  }
  return reachable > 0 ? reachable / totalDist : 0
}

export function computeAuthority(orgId: string, nodes: Node[], links: Link[]): number {
  // Authority: number of incoming edges from MEPs or Commission
  return links.filter(l =>
    l.target === orgId &&
    nodes.find(n => n.id === l.source && (n.type === 'mep' || n.type === 'commission_employee'))
  ).length
}
