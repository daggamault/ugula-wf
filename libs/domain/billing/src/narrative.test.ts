import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompletionRequest } from './completions.ts';
import { ALS2_PROCEDURES, readFindings, readNarrative, TRUNCATED_NOTE } from './narrative.ts';

const NO_FINDINGS = { medications: [], procedures: [], ivDoses: 0, notes: [] };

describe('narrative request', () => {
  it('asks for medication doses and the CMS ALS2 procedures as structured output', async () => {
    const asked: CompletionRequest[] = [];
    await readNarrative(
      {
        complete: async (r) => {
          asked.push(r);
          return {};
        }
      },
      `ASA 324 PO. ${'x'.repeat(20_000)}`
    );
    const [request] = asked;
    if (!request) throw new Error('The model was not asked');
    assert.deepEqual(
      (await readNarrative({ complete: async () => ({}) }, 'x'.repeat(12_001))).notes,
      [TRUNCATED_NOTE]
    );
    assert.equal(request.user.length, 12_000);
    assert.match(request.system, /how many separate doses/);
    assert.match(request.system, /intraosseous line/);
    assert.match(request.system, /exact words copied from the narrative/);
    assert.deepEqual(Object.keys(request.schema.properties as object), [
      'medications',
      'procedures'
    ]);
    assert.equal(request.maxTokens, 1_200);
  });
});

describe('readFindings', () => {
  const narrative = `Fentanyl 50 mcg IV x2. Epinephrine 1 mg IO repeated q3 min.
    Aspirin 324 mg PO. Ondansetron 4 mg IV. NS 500 mL bolus IV. D50 25 g IV.
    Manual defibrillation at 200J. IV established. AED shock delivered by bystander.`;

  it('keeps medications and procedures the narrative quotes, and counts IV and IO doses', () => {
    assert.deepEqual(
      readFindings(
        {
          medications: [
            { medication: ' fentanyl ', route: 'IV', doses: 2, evidence: 'Fentanyl 50 mcg IV x2' },
            { medication: 'epinephrine', route: 'IO', doses: 99, evidence: 'epinephrine 1 mg io' },
            { medication: 'aspirin', route: 'PO', doses: 1, evidence: 'Aspirin 324 mg PO' },
            { medication: 'ondansetron', route: 'IV', doses: 1.5, evidence: 'Ondansetron 4 mg IV' },
            { medication: '', route: 'IV', doses: 1, evidence: 'IV established' },
            { medication: 'saline', route: 'IVPB', doses: 1, evidence: 'NS 500 mL bolus IV' },
            'junk'
          ],
          procedures: [
            { procedure: 'defibrillation', evidence: 'Manual defibrillation at 200J' },
            { procedure: 'defibrillation', evidence: 'defibrillation at 200J' },
            { procedure: 'CPR', evidence: 'IV established' }
          ]
        },
        narrative
      ),
      {
        medications: [
          { medication: 'fentanyl', route: 'IV', doses: 2 },
          { medication: 'epinephrine', route: 'IO', doses: 20 },
          { medication: 'aspirin', route: 'PO', doses: 1 },
          { medication: 'ondansetron', route: 'IV', doses: 1 }
        ],
        procedures: ['defibrillation'],
        ivDoses: 23,
        notes: []
      }
    );
    assert.deepEqual(readFindings('nonsense', narrative), NO_FINDINGS);
    assert.equal(ALS2_PROCEDURES.length, 8);
  });

  it('drops findings the narrative does not say, as small models list every option', () => {
    assert.deepEqual(
      readFindings(
        {
          medications: [
            { medication: 'amiodarone', route: 'IV', doses: 1, evidence: 'amiodarone 150 mg IV' },
            { medication: 'fentanyl', route: 'IV', doses: 1, evidence: '' }
          ],
          procedures: ALS2_PROCEDURES.map((procedure) => ({ procedure, evidence: 'intubated' }))
        },
        narrative
      ),
      NO_FINDINGS
    );
  });

  it('only takes a procedure whose quote names it, and never an AED shock', () => {
    assert.deepEqual(
      readFindings(
        {
          medications: [],
          procedures: [
            { procedure: 'intraosseous line', evidence: 'IV established' },
            { procedure: 'defibrillation', evidence: 'AED shock delivered by bystander' },
            { procedure: 'cardioversion', evidence: 'Manual defibrillation at 200J' }
          ]
        },
        narrative
      ).procedures,
      []
    );
  });

  it('leaves saline, Ringer and dextrose out of the medications', () => {
    assert.deepEqual(
      readFindings(
        {
          medications: [
            { medication: 'NS', route: 'IV', doses: 1, evidence: 'NS 500 mL bolus IV' },
            { medication: 'D50', route: 'IV', doses: 1, evidence: 'D50 25 g IV' },
            { medication: 'Ondansetron', route: 'IV', doses: 1, evidence: 'Ondansetron 4 mg IV' }
          ],
          procedures: []
        },
        narrative
      ).medications,
      [{ medication: 'Ondansetron', route: 'IV', doses: 1 }]
    );
  });
});

describe('readNarrative', () => {
  it('skips the model for empty narratives and validates what it answers', async () => {
    const asked: CompletionRequest[] = [];
    const completer = {
      complete: async (r: CompletionRequest) => {
        asked.push(r);
        return {
          medications: [
            { medication: 'amiodarone', route: 'IO', doses: 1, evidence: 'Amiodarone 300 IO' }
          ],
          procedures: []
        };
      }
    };
    assert.deepEqual(await readNarrative(completer, '  '), NO_FINDINGS);
    assert.equal(asked.length, 0);
    assert.deepEqual(await readNarrative(completer, 'Amiodarone 300 IO'), {
      medications: [{ medication: 'amiodarone', route: 'IO', doses: 1 }],
      procedures: [],
      ivDoses: 1,
      notes: []
    });
    assert.equal(asked[0]?.user, 'Amiodarone 300 IO');
  });
});
