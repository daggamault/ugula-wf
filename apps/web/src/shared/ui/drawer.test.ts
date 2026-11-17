import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { Drawer } from './drawer.tsx';

const drawerClasses = (width: 'md' | 'lg') => {
  render(createElement(Drawer, { width, children: createElement('p', null, 'Body') }));
  return screen.getByText('Body').parentElement?.classList;
};

describe('Drawer', () => {
  it('holds its content', () => {
    render(createElement(Drawer, { width: 'md', children: createElement('p', null, 'Body') }));
    screen.getByText('Body');
  });

  it('floats over the page on mobile and sits beside it from small screens up', () => {
    const classes = drawerClasses('md');
    assert.equal(classes?.contains('absolute'), true);
    assert.equal(classes?.contains('inset-0'), true);
    assert.equal(classes?.contains('sm:static'), true);
  });

  it('is medium wide when asked', () => {
    const classes = drawerClasses('md');
    assert.equal(classes?.contains('sm:w-96'), true);
    assert.equal(classes?.contains('sm:w-[32rem]'), false);
  });

  it('is large wide when asked', () => {
    const classes = drawerClasses('lg');
    assert.equal(classes?.contains('sm:w-[32rem]'), true);
    assert.equal(classes?.contains('sm:w-96'), false);
  });
});
