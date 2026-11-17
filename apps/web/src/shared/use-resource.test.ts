import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, render, screen, userEvent, waitFor } from './testing-dom.ts';
import {
  createLoadQueue,
  loadFailure,
  type Resource,
  refreshFailure,
  useResource
} from './use-resource.ts';

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const loader = () => {
  const calls: { key: string; signal: AbortSignal; result: ReturnType<typeof deferred<string>> }[] =
    [];
  const load = (key: string) => (signal: AbortSignal) => {
    const result = deferred<string>();
    calls.push({ key, signal, result });
    return result.promise;
  };
  return { calls, load };
};

const stateOf = ({ data, error, loading }: Resource<unknown>) =>
  `${String(data)}|${error?.message ?? ''}|${loading}`;

type ProbeProps = {
  resourceKey: string;
  load: (key: string) => (signal: AbortSignal) => Promise<unknown>;
  pollMs?: number;
};

const Probe = ({ resourceKey, load, pollMs }: ProbeProps) => {
  const resource = useResource(resourceKey, load(resourceKey), pollMs);
  return createElement(
    'div',
    null,
    createElement('output', null, stateOf(resource)),
    createElement('button', { type: 'button', onClick: resource.reload }, 'Reload')
  );
};

const shown = () => screen.getByRole('status').textContent;

describe('useResource', () => {
  it('starts loading without data before effects run', () => {
    const html = renderToStaticMarkup(
      createElement(Probe, { resourceKey: 'k', load: () => async () => 'x' })
    );
    assert.equal(
      html,
      '<div><output>undefined||true</output><button type="button">Reload</button></div>'
    );
  });

  it('loads the data and stops loading', async () => {
    const { calls, load } = loader();
    render(createElement(Probe, { resourceKey: 'fees', load }));
    assert.equal(shown(), 'undefined||true');
    await act(async () => calls[0]?.result.resolve('Fee list'));
    assert.equal(shown(), 'Fee list||false');
    assert.deepEqual(
      calls.map((c) => c.key),
      ['fees']
    );
  });

  it('reports a failed first load without data', async () => {
    const { calls, load } = loader();
    render(createElement(Probe, { resourceKey: 'fees', load }));
    await act(async () => calls[0]?.result.reject(new Error('Network down')));
    assert.equal(shown(), 'undefined|Network down|false');
  });

  it('wraps a thrown non-error in an error', async () => {
    const { calls, load } = loader();
    render(createElement(Probe, { resourceKey: 'fees', load }));
    await act(async () => calls[0]?.result.reject('offline'));
    assert.equal(shown(), 'undefined|offline|false');
  });

  it('keeps the loaded data when a reload fails and clears the error once one succeeds', async () => {
    const { calls, load } = loader();
    render(createElement(Probe, { resourceKey: 'fees', load }));
    await act(async () => calls[0]?.result.resolve('v1'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    assert.equal(shown(), 'v1||true');
    await act(async () => calls[1]?.result.reject(new Error('Network down')));
    assert.equal(shown(), 'v1|Network down|false');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await act(async () => calls[2]?.result.resolve('v2'));
    assert.equal(shown(), 'v2||false');
  });

  it('runs one more load for reloads asked for while one is in flight', async () => {
    const { calls, load } = loader();
    render(createElement(Probe, { resourceKey: 'fees', load }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    assert.equal(calls.length, 1);
    await act(async () => calls[0]?.result.resolve('v1'));
    assert.equal(calls.length, 2);
    await act(async () => calls[1]?.result.resolve('v2'));
    assert.equal(calls.length, 2);
    assert.equal(shown(), 'v2||false');
  });

  it('drops the old data on a new key and ignores the answer of the abandoned load', async () => {
    const { calls, load } = loader();
    const { rerender } = render(createElement(Probe, { resourceKey: 'fee/f1', load }));
    await act(async () => calls[0]?.result.resolve('Fee 1'));
    rerender(createElement(Probe, { resourceKey: 'fee/f2', load }));
    assert.equal(shown(), 'undefined||true');
    rerender(createElement(Probe, { resourceKey: 'fee/f3', load }));
    assert.equal(calls[1]?.signal.aborted, true);
    await act(async () => calls[1]?.result.resolve('Fee 2'));
    assert.equal(shown(), 'undefined||true');
    await act(async () => calls[2]?.result.resolve('Fee 3'));
    assert.equal(shown(), 'Fee 3||false');
  });

  it('does not carry data across keys when the new key fails', async () => {
    const { calls, load } = loader();
    const { rerender } = render(createElement(Probe, { resourceKey: 'fee/f1', load }));
    await act(async () => calls[0]?.result.resolve('Fee 1'));
    rerender(createElement(Probe, { resourceKey: 'fee/f2', load }));
    await act(async () => calls[1]?.result.reject(new Error('Not found')));
    assert.equal(shown(), 'undefined|Not found|false');
  });

  it('aborts the load in flight on unmount', () => {
    const { calls, load } = loader();
    const { unmount } = render(createElement(Probe, { resourceKey: 'fees', load }));
    unmount();
    assert.equal(calls[0]?.signal.aborted, true);
  });

  it('polls on the given interval until unmounted', async () => {
    let loads = 0;
    const load = () => async () => `v${++loads}`;
    const { unmount } = render(createElement(Probe, { resourceKey: 'q', load, pollMs: 20 }));
    await waitFor(() => assert.ok(loads >= 3));
    assert.match(shown() ?? '', /^v\d+\|\|false$/);
    unmount();
    const after = loads;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(loads, after);
  });
});

describe('loadFailure and refreshFailure', () => {
  it('fail the page only for data never loaded, and report a failed refresh inline', () => {
    const lost = new Error('Network down');
    const loaded = { data: 'task', error: lost };
    const fresh = { data: 'claim', error: undefined };
    assert.equal(loadFailure(loaded, fresh), undefined);
    assert.equal(refreshFailure(loaded, fresh), 'Network down');
    assert.equal(loadFailure(fresh, { data: undefined, error: lost }), lost);
    assert.equal(refreshFailure(fresh), '');
  });
});

describe('createLoadQueue', () => {
  it('holds reloads asked for while a load runs and replays them once afterwards', () => {
    const queue = createLoadQueue();
    assert.equal(queue.request(), true);
    queue.start();
    assert.equal(queue.request(), false);
    assert.equal(queue.request(), false);
    assert.equal(queue.finish(), true);
    queue.start();
    assert.equal(queue.finish(), false);
    assert.equal(queue.request(), true);
  });
});
