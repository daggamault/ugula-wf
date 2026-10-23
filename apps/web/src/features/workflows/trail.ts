export type TrailStep = { graphId: string; version: number };

export const parseTrail = (raw: string | null): TrailStep[] =>
  (raw ?? '').split(',').flatMap((part) => {
    const [graphId = '', v] = part.split(':');
    const version = Number(v);
    return graphId && Number.isInteger(version) && version > 0 ? [{ graphId, version }] : [];
  });

export const graphPath = (graphId: string, version: number, trail: readonly TrailStep[] = []) =>
  `/workflows/${graphId}?version=${version}${
    trail.length ? `&trail=${trail.map((s) => `${s.graphId}:${s.version}`).join(',')}` : ''
  }`;
