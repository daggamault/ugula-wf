import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { act, render, screen, userEvent } from './testing-dom.ts';
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
  const Probe = ({ work }: { work: () => Promise<void> }) => {
    const { busy, error, run } = usePending();
    return createElement(
      'div',
      null,
      createElement('button', { type: 'button', onClick: () => void run(work) }, 'Save'),
      createElement('output', null, `${busy}|${error}`)
    );
  };

  it('is busy while the work runs, then shows its failure until the next try', async () => {
    const settle: { resolve: () => void; reject: (err: Error) => void }[] = [];
    const work = () => new Promise<void>((resolve, reject) => settle.push({ resolve, reject }));
    render(createElement(Probe, { work }));
    const status = screen.getByRole('status');
    assert.equal(status.textContent, 'false|');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    assert.equal(status.textContent, 'true|');
    await act(async () => settle[0]?.reject(new Error('Fee code taken')));
    assert.equal(status.textContent, 'false|Fee code taken');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    assert.equal(status.textContent, 'true|');
    await act(async () => settle[1]?.resolve());
    assert.equal(status.textContent, 'false|');
  });
});
