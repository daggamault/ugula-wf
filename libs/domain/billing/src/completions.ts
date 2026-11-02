export type CompletionRequest = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
};

export type Completer = {
  complete: (request: CompletionRequest) => Promise<unknown>;
};
