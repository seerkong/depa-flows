/** 节点邻接仅用于结构分析；命名端口和业务边仍由调用方持有。 */
export function createAdjacencyProjection<I>() {
  const adjacency = new Map<I, Set<I>>();
  const addVertex = (id: I) => {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
  };
  const addEdge = (from: I, to: I) => {
    if (adjacency.has(to)) adjacency.get(from)?.add(to);
  };
  const nextIds = (id: I): ReadonlySet<I> => adjacency.get(id) ?? new Set<I>();
  // 包含起点。每个节点只入队一次，环和共享尾部不会造成无界遍历。
  const reachableFrom = (start: I): Set<I> => {
    const reached = new Set<I>([start]);
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const next of nextIds(queue[cursor])) {
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    return reached;
  };
  const unreachableFrom = (start: I): I[] => {
    const reached = reachableFrom(start);
    return [...adjacency.keys()].filter((id) => !reached.has(id));
  };
  return { addVertex, addEdge, nextIds, reachableFrom, unreachableFrom };
}
