import { useState } from 'react';
import { messageOf } from './api.ts';

type PendingSetters = {
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
};

export const runPending = async (
  work: () => Promise<void>,
  { setBusy, setError }: PendingSetters
) => {
  setBusy(true);
  setError('');
  try {
    await work();
  } catch (err) {
    setError(messageOf(err));
  } finally {
    setBusy(false);
  }
};

export const usePending = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = (work: () => Promise<void>) => runPending(work, { setBusy, setError });
  return { busy, error, setError, run };
};
