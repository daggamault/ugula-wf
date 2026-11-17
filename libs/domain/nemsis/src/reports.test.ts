import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reportKey } from './reports.ts';

describe('reportKey', () => {
  it('stores each report next to its file, numbered by position', () => {
    assert.equal(
      reportKey({ bucket: 'ugula', key: 'in/file.xml' }, 1),
      'in/file.xml.reports/00001.json'
    );
  });
});
