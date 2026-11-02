export const fail = (message: string): never => {
  throw new Error(message);
};

export const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
