import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  deleteFacility,
  findFacility,
  insertFacility,
  searchFacilities,
  searchHospitals,
  updateFacility
} from './queries.ts';

const input = {
  name: 'Sunrise SNF',
  addressLine: null,
  city: 'Springfield',
  state: 'IL',
  postalCode: null,
  phone: null,
  kind: 'snf' as const,
  hasContract: true,
  contractNote: null
};

const isFacet = (sql: string) => sql.includes('group by 1');

const flat = (sql = '') => sql.replace(/\s+/g, ' ');

describe('facility queries', () => {
  it('scopes every query to the agency and totals what each facility owes', async () => {
    const { db, queries } = createRecordingDb(({ sql }) =>
      isFacet(sql) ? [] : sql.startsWith('select') ? [{ id: 'f1', total: '1' }] : [{ id: 'f1' }]
    );
    await searchFacilities(db, 't-1', {
      q: 'sun',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc',
      kind: []
    });
    await findFacility(db, 't-1', 'f1');
    assert.deepEqual(await insertFacility(db, 't-1', input), { id: 'f1' });
    assert.deepEqual(await updateFacility(db, 't-1', 'f1', input), { id: 'f1' });
    assert.equal(await deleteFacility(db, 't-1', 'f1'), true);
    assert.ok(queries.every((q) => q.parameters.includes('t-1')));
    const insert = queries.find((q) => q.sql.startsWith('insert'));
    assert.ok(insert?.sql.includes('"kind", "has_contract", "contract_note"'));
    assert.ok(insert?.parameters.includes('snf') && insert.parameters.includes(true));
    const page = queries.find((q) => !isFacet(q.sql));
    assert.ok(page?.sql.includes('sum(b.balance_cents)'));
    assert.ok(page?.parameters.includes('%sun%'));
    assert.ok(insert?.sql.includes('on conflict (agency_id, lower(name)) do nothing'));
  });

  it('filters by kind and counts kinds under the search alone', async () => {
    const { db, queries } = createRecordingDb((q) =>
      isFacet(q.sql) ? [{ value: 'snf', label: null, count: '3' }] : []
    );
    const page = await searchFacilities(db, 't-1', {
      q: 'sun',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc',
      kind: ['snf', 'hospital']
    });
    assert.deepEqual(page.facets, { kind: [{ value: 'snf', count: 3 }] });
    const list = queries.find((q) => !isFacet(q.sql));
    assert.ok(
      flat(list?.sql).includes(
        'where "f"."agency_id" = $5 and lower(f.name) like $6 and "f"."kind" in ($7, $8)'
      )
    );
    assert.deepEqual(list?.parameters.slice(4, 8), ['t-1', '%sun%', 'snf', 'hospital']);
    const facet = queries.find((q) => isFacet(q.sql));
    assert.equal(
      flat(facet?.sql),
      'select "f"."kind"::text as "value", null as "label", count(*) as "count" from "facilities" as "f" where "f"."agency_id" = $1 and lower(f.name) like $2 and "f"."kind" is not null group by 1 order by count(*) desc, 1 limit $3'
    );
  });
});

describe('searchHospitals', () => {
  it('finds CMS hospitals whose name has every word, closest first, and none for no words', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchHospitals(db, 'Mercy  St_');
    assert.deepEqual(await searchHospitals(db, '  '), []);
    assert.equal(queries.length, 1);
    assert.ok(
      queries[0]?.sql.endsWith(
        'from "cms_hospitals" where ("name" ilike $1 and "name" ilike $2) order by similarity($3, name) desc, "name" limit $4'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['%mercy%', '%st\\_%', 'Mercy  St_', 20]);
  });
});

describe('facility queries without matches', () => {
  it('lists every facility without a search, finds no hospitals without one and reports a missed delete', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchFacilities(db, 't-1', {
      page: 1,
      pageSize: 25,
      sort: 'city',
      dir: 'desc',
      kind: []
    });
    const list = queries.find((q) => !isFacet(q.sql));
    assert.ok(!list?.sql.includes('like'));
    assert.ok(list?.sql.includes('order by lower(f.city) desc nulls last'));
    assert.deepEqual(await searchHospitals(db, undefined), []);
    assert.equal(await deleteFacility(db, 't-1', 'f1'), false);
    assert.equal(queries.length, 3);
  });
});
