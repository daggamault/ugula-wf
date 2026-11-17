import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { sql } from 'kysely';
import * as v from 'valibot';
import { facetCounts, facetValues, whereFacets } from './facets.ts';

const defs = {
  kind: { value: sql.ref('g.kind') },
  owner: { value: sql.ref('g.agency_id'), label: sql.ref('g.name') }
};

describe('facetValues', () => {
  const schema = v.object({ kind: facetValues(v.picklist(['workflow', 'node'])) });

  it('reads a comma list once each and defaults to none', () => {
    assert.deepEqual(v.parse(schema, {}), { kind: [] });
    assert.deepEqual(v.parse(schema, { kind: 'node,workflow,node,' }), {
      kind: ['node', 'workflow']
    });
  });

  it('rejects values outside the schema and too many values', () => {
    assert.equal(v.safeParse(schema, { kind: 'node,drop' }).success, false);
    const many = v.object({ id: facetValues(v.string()) });
    const list = Array.from({ length: 51 }, (_, i) => `v${i}`).join(',');
    assert.equal(v.safeParse(many, { id: list }).success, false);
  });
});

describe('whereFacets', () => {
  it('filters each chosen facet and skips the excepted and empty ones', async () => {
    const { db, queries } = createRecordingDb();
    const filters = { kind: ['node', 'workflow'], owner: ['a'] };
    await whereFacets(db.selectFrom('graphs as g').select('g.id'), defs, filters).execute();
    await whereFacets(db.selectFrom('graphs as g').select('g.id'), defs, filters, 'kind').execute();
    await whereFacets(db.selectFrom('graphs as g').select('g.id'), defs, {
      kind: [],
      owner: []
    }).execute();
    assert.equal(
      queries[0]?.sql,
      'select "g"."id" from "graphs" as "g" where "g"."kind" in ($1, $2) and "g"."agency_id" in ($3)'
    );
    assert.deepEqual(queries[0]?.parameters, ['node', 'workflow', 'a']);
    assert.equal(
      queries[1]?.sql,
      'select "g"."id" from "graphs" as "g" where "g"."agency_id" in ($1)'
    );
    assert.equal(queries[2]?.sql, 'select "g"."id" from "graphs" as "g"');
  });
});

describe('facetCounts', () => {
  it('counts each facet under every other filter, most common first', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('min(')
        ? [{ value: 'a', label: 'Agency A', count: '3' }]
        : [
            { value: 'workflow', label: null, count: '5' },
            { value: 'node', label: null, count: '2' }
          ]
    );
    const filters = { kind: ['node'], owner: ['a'] };
    const facets = await facetCounts(
      (except) =>
        whereFacets(db.selectFrom('graphs as g').select('g.id'), defs, filters, except).orderBy(
          'g.id'
        ),
      defs
    );
    assert.deepEqual(facets, {
      kind: [
        { value: 'workflow', count: 5 },
        { value: 'node', count: 2 }
      ],
      owner: [{ value: 'a', label: 'Agency A', count: 3 }]
    });
    assert.equal(
      queries[0]?.sql,
      'select "g"."kind"::text as "value", null as "label", count(*) as "count" from "graphs" as "g" where "g"."agency_id" in ($1) and "g"."kind" is not null group by 1 order by count(*) desc, 1 limit $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['a', 200]);
    assert.equal(
      queries[1]?.sql,
      'select "g"."agency_id"::text as "value", min("g"."name"::text) as "label", count(*) as "count" from "graphs" as "g" where "g"."kind" in ($1) and "g"."agency_id" is not null group by 1 order by count(*) desc, 1 limit $2'
    );
  });
});
