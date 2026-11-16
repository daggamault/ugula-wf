import { useCallback, useEffect, useRef } from 'react';
import { currentAgency } from './router.tsx';

export type UploadScope = { agencyId: string | null; signal: AbortSignal };

export const useUploadScope = () => {
  const mounted = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    mounted.current = c;
    return () => c.abort();
  }, []);
  return useCallback(
    (): UploadScope => ({
      agencyId: currentAgency(),
      signal: mounted.current?.signal ?? AbortSignal.abort()
    }),
    []
  );
};
