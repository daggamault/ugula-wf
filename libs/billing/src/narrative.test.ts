import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompletionRequest } from './completions.ts';
import {
  ALS2_PROCEDURES,
  NO_FINDINGS,
  narrativeRequest,
  readFindings,
  readNarrative
} from './narrative.ts';

describe('narrativeRequest', () => {
  it('asks for medication doses and the CMS ALS2 procedures as structured output', () => {
    const request = narrativeRequest(`ASA 324 PO. ${'x'.repeat(20_000)}`);
    assert.equal(request.user.length, 12_000);
    assert.match(request.system, /how many separate doses/);
    assert.match(request.system, /intraosseous line/);
    assert.deepEqual(Object.keys(request.schema.properties as object), [
      'medications',
      'procedures'
    ]);
    assert.equal(request.maxTokens, 800);
  });
});

describe('readFindings', () => {
  it('keeps valid medications and procedures and counts IV and IO doses', () => {
    assert.deepEqual(
      readFindings({
        medications: [
          { medication: ' fentanyl ', route: 'IV', doses: 2 },
          { medication: 'epinephrine', route: 'IO', doses: 99 },
          { medication: 'aspirin', route: 'PO', doses: 1 },
          { medication: 'ondansetron', route: 'IV', doses: 1.5 },
          { medication: '', route: 'IV', doses: 1 },
          { medication: 'saline', route: 'IVPB', doses: 1 },
          'junk'
        ],
        procedures: ['defibrillation', 'defibrillation', 'CPR']
      }),
      {
        medications: [
          { medication: 'fentanyl', route: 'IV', doses: 2 },
          { medication: 'epinephrine', route: 'IO', doses: 20 },
          { medication: 'aspirin', route: 'PO', doses: 1 },
          { medication: 'ondansetron', route: 'IV', doses: 1 }
        ],
        procedures: ['defibrillation'],
        ivDoses: 23
      }
    );
    assert.deepEqual(readFindings('nonsense'), NO_FINDINGS);
    assert.equal(ALS2_PROCEDURES.length, 8);
  });
});

describe('readNarrative', () => {
  it('skips the model for empty narratives and validates what it answers', async () => {
    const asked: CompletionRequest[] = [];
    const completer = {
      complete: async (r: CompletionRequest) => {
        asked.push(r);
        return {
          medications: [{ medication: 'amiodarone', route: 'IO', doses: 1 }],
          procedures: []
        };
      }
    };
    assert.deepEqual(await readNarrative(completer, '  '), NO_FINDINGS);
    assert.equal(asked.length, 0);
    assert.deepEqual(await readNarrative(completer, 'Amiodarone 300 IO'), {
      medications: [{ medication: 'amiodarone', route: 'IO', doses: 1 }],
      procedures: [],
      ivDoses: 1
    });
    assert.equal(asked[0]?.user, 'Amiodarone 300 IO');
  });
});
