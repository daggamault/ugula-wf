import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runPending, usePending } from './use-pending.ts';

const recorder = () => {
  const log: string[] = [];
  return {
    log,
    setters: {
      setBusy: (busy: boolean) => void log.push(`busy:${busy}`),
      setError: (message: string) => void log.push(`error:${message}`)
    }
  };
};

describe('runPending', () => {
  it('marks the work busy, clears the last error and settles', async () => {
    const { log, setters } = recorder();
    await runPending(async () => void log.push('work'), setters);
    assert.deepEqual(log, ['busy:true', 'error:', 'work', 'busy:false']);
  });

  it('shows why the work failed', async () => {
    const { log, setters } = recorder();
    await runPending(async () => {
      throw new Error('Nope');
    }, setters);
    assert.deepEqual(log, ['busy:true', 'error:', 'error:Nope', 'busy:false']);
  });
});

describe('usePending', () => {
  it('starts idle without an error', () => {
    const Probe = () => {
      const { busy, error } = usePending();
      return createElement('p', null, `${busy}|${error}`);
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>false|</p>');
  });
});
