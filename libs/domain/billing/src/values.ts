export const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

export const recordOf = (x: unknown): Record<string, unknown> => (isRecord(x) ? x : {});

export const textOrNull = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);

export const isCents = (x: unknown): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= 0;

export const requiredText = (x: unknown, message: string) => {
  const text = textOrNull(x);
  if (!text) throw new Error(message);
  return text;
};
