import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type EventDef, type GraphDef, INPUT_TYPE, RETURN_TYPE } from '@ugula/graph';
import { testNodes } from '../testing.ts';
import { createCatalog } from './catalog.ts';
import {
  dropUnfit,
  eventSuggestions,
  keyFromName,
  nameExit,
  namePin,
  nameTaken,
  nameVariable,
  pinUsed,
  removePin,
  renamePin,
  renamePinNamed,
  renameVariable,
  retypePin,
  setPins,
  setVariables
} from './signature-edits.ts';

const catalog = createCatalog(testNodes);

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: ['done'],
    inputs: [
      { name: 'x', type: 'number' },
      { name: 'spare', type: 'string' }
    ],
    outputs: [
      { name: 'y', type: 'number' },
      { name: 'loose', type: 'string' }
    ]
  },
  variables: [{ name: 'count', type: 'number', default: 0 }],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'add1', type: 'std.math.add', version: 1 },
    { id: 'in1', type: INPUT_TYPE, version: 1, config: { pin: 'x' } },
    { id: 'get1', type: 'std.var.get', version: 1, config: { name: 'count' } },
    {
      id: 'return1',
      type: RETURN_TYPE,
      version: 1,
      config: { pin: 'done' },
      inputs: { y: { value: 1 } }
    }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'return1', toPin: 'exec' },
    { from: 'entry', fromPin: 'x', to: 'add1', toPin: 'a' },
    { from: 'add1', fromPin: 'result', to: 'return1', toPin: 'y' }
  ]
};

describe('keyFromName', () => {
  it('turns a friendly name into a camelCase key that is free', () => {
    assert.equal(keyFromName('Primary Payer', []), 'primaryPayer');
    assert.equal(keyFromName('  ICD-10 code! ', []), 'iCD10Code');
    assert.equal(keyFromName('Payer', ['payer']), 'payer2');
    assert.equal(keyFromName('2nd Payer', []), 'value2ndPayer');
    assert.equal(keyFromName('constructor', []), 'valueconstructor');
  });
});

describe('pinUsed', () => {
  it('sees wires, Input nodes and Return values', () => {
    assert.equal(pinUsed(def, 'inputs', 'x'), true);
    assert.equal(pinUsed(def, 'inputs', 'spare'), false);
    assert.equal(pinUsed(def, 'outputs', 'y'), true);
    assert.equal(pinUsed(def, 'outputs', 'loose'), false);
  });
});

describe('renamePin', () => {
  it('carries an input rename through its wires and Input nodes', () => {
    const renamed = renamePin(def, 'inputs', 'x', 'amount');
    assert.deepEqual(renamed.signature.inputs[0], { name: 'amount', type: 'number' });
    assert.deepEqual(renamed.edges[1], {
      from: 'entry',
      fromPin: 'amount',
      to: 'add1',
      toPin: 'a'
    });
    assert.deepEqual(renamed.nodes[2]?.config, { pin: 'amount' });
  });

  it('carries an output rename through its wires and Return values', () => {
    const renamed = renamePin(def, 'outputs', 'y', 'total');
    assert.deepEqual(renamed.edges[2]?.toPin, 'total');
    assert.deepEqual(renamed.nodes[4]?.inputs, { total: { value: 1 } });
  });
});

describe('namePin', () => {
  it('renames the key of an unused pin and keeps no label it does not need', () => {
    const named = namePin(def, 'inputs', 1, 'Billing Note');
    assert.deepEqual(named.signature.inputs[1], { name: 'billingNote', type: 'string' });
  });

  it('keeps the key of a pin in use, so nothing that uses it breaks, and labels it', () => {
    const named = namePin(def, 'outputs', 0, 'Grand Total');
    assert.deepEqual(named.signature.outputs[0], {
      name: 'y',
      type: 'number',
      label: 'Grand Total'
    });
    assert.deepEqual(named.edges, def.edges);
  });

  it('keeps the key of an input an event fills in by name', () => {
    const events: EventDef[] = [
      {
        type: 'claim.denied',
        label: 'Claim Denied',
        description: '',
        payload: [{ name: 'spare', type: 'string' }]
      }
    ];
    const triggered: GraphDef = {
      ...def,
      nodes: def.nodes.map((n) =>
        n.type === ENTRY_TYPE
          ? { ...n, config: { trigger: { kind: 'event', event: 'claim.denied', where: {} } } }
          : n
      )
    };
    const named = namePin(triggered, 'inputs', 1, 'Denial Note', events);
    assert.deepEqual(named.signature.inputs[1], {
      name: 'spare',
      type: 'string',
      label: 'Denial Note'
    });
  });

  it('ignores a blank name', () => {
    assert.equal(namePin(def, 'inputs', 0, '   '), def);
  });
});

describe('nameTaken', () => {
  it('compares friendly names, ignoring case and the pin itself', () => {
    assert.equal(nameTaken(def.signature.inputs, 1, ' x '), true);
    assert.equal(nameTaken(def.signature.inputs, 0, 'X'), false);
  });
});

describe('eventSuggestions', () => {
  it('offers the fields of the starting event that are not inputs yet', () => {
    const events: EventDef[] = [
      {
        type: 'claim.denied',
        label: 'Claim Denied',
        description: '',
        payload: [
          { name: 'x', type: 'number' },
          { name: 'claimId', type: 'string' }
        ]
      }
    ];
    const triggered: GraphDef = {
      ...def,
      nodes: def.nodes.map((n) =>
        n.type === ENTRY_TYPE
          ? { ...n, config: { trigger: { kind: 'event', event: 'claim.denied', where: {} } } }
          : n
      )
    };
    assert.deepEqual(
      eventSuggestions(triggered, events).map((f) => f.name),
      ['claimId']
    );
    assert.deepEqual(eventSuggestions(def, events), []);
  });
});

describe('retypePin', () => {
  it('disconnects the wires the new type no longer fits, and counts them', () => {
    const { def: retyped, dropped } = retypePin(def, catalog, 'inputs', 0, 'string');
    assert.equal(dropped, 1);
    assert.ok(!retyped.edges.some((e) => e.fromPin === 'x'));
  });

  it('keeps the wires a widened type still fits', () => {
    assert.equal(retypePin(def, catalog, 'outputs', 0, 'any').dropped, 0);
  });

  it('keeps a default that still fits and drops one that does not', () => {
    const withDefault: GraphDef = {
      ...def,
      signature: {
        ...def.signature,
        inputs: [{ name: 'x', type: 'number', optional: true, default: 3 }]
      }
    };
    assert.equal(
      retypePin(withDefault, catalog, 'inputs', 0, 'integer').def.signature.inputs[0]?.default,
      3
    );
    assert.equal(
      retypePin(withDefault, catalog, 'inputs', 0, 'string').def.signature.inputs[0]?.default,
      undefined
    );
  });
});

describe('dropUnfit', () => {
  it('only drops wires the change broke, never ones already broken', () => {
    const broken: GraphDef = {
      ...def,
      edges: [...def.edges, { from: 'add1', fromPin: 'nope', to: 'return1', toPin: 'loose' }]
    };
    const { def: kept, dropped } = dropUnfit(broken, broken, catalog);
    assert.equal(dropped, 0);
    assert.equal(kept, broken);
  });
});

describe('renameVariable', () => {
  it('renames the variable and every Get and Set that uses it', () => {
    const renamed = renameVariable(def, 'count', 'tally');
    assert.equal(renamed.variables[0]?.name, 'tally');
    assert.deepEqual(renamed.nodes[3]?.config, { name: 'tally' });
  });
});

describe('nameExit', () => {
  it('keeps the key of an exit a Return node finishes through, and labels it', () => {
    const named = nameExit(def, 0, 'All Done');
    assert.deepEqual(named.signature.execOut, ['done']);
    assert.deepEqual(named.signature.exits, { done: { label: 'All Done' } });
  });

  it('renames the key of an exit nothing finishes through yet', () => {
    const free: GraphDef = { ...def, signature: { ...def.signature, execOut: ['done', 'exit2'] } };
    assert.deepEqual(nameExit(free, 1, 'Rejected').signature.execOut, ['done', 'rejected']);
  });
});

describe('removePin', () => {
  it('removes an output with its wires and the values Return held for it', () => {
    const removed = removePin(def, catalog, 'outputs', 'y');
    assert.deepEqual(
      removed.signature.outputs.map((p) => p.name),
      ['loose']
    );
    assert.ok(!removed.edges.some((e) => e.toPin === 'y'));
    assert.deepEqual(removed.nodes[4]?.inputs, {});
  });

  it('removes an input with the wires that came from it', () => {
    const removed = removePin(def, catalog, 'inputs', 'x');
    assert.deepEqual(
      removed.signature.inputs.map((p) => p.name),
      ['spare']
    );
    assert.ok(!removed.edges.some((e) => e.fromPin === 'x'));
    assert.ok(!removed.nodes.some((n) => n.id === 'in1'));
  });
});

describe('setPins', () => {
  it('drops what used the pins a list no longer has, and keeps the rest in its order', () => {
    const { def: next } = setPins(def, catalog, 'outputs', [{ name: 'loose', type: 'string' }]);
    assert.deepEqual(next.nodes[4]?.inputs, {});
    assert.ok(!next.edges.some((e) => e.toPin === 'y'));
    const moved = setPins(def, catalog, 'inputs', [...def.signature.inputs].reverse());
    assert.deepEqual([moved.dropped, moved.def.nodes, moved.def.edges], [0, def.nodes, def.edges]);
  });
});

describe('pin names never clash with exec pins', () => {
  it('numbers an output named like an exit, and an exit named like an output', () => {
    assert.equal(namePin(def, 'outputs', 1, 'Done').signature.outputs[1]?.name, 'done2');
    const withExit: GraphDef = {
      ...def,
      signature: { ...def.signature, execOut: ['done', 'exit2'] }
    };
    assert.deepEqual(nameExit(withExit, 1, 'Loose').signature.execOut, ['done', 'loose2']);
  });

  it('numbers an input named like the exec input', () => {
    assert.equal(namePin(def, 'inputs', 1, 'Exec').signature.inputs[1]?.name, 'exec2');
  });
});

describe('nameVariable', () => {
  const withExpr: GraphDef = {
    ...def,
    nodes: [
      ...def.nodes,
      { id: 'add2', type: 'std.math.add', version: 1, inputs: { a: { expr: 'count + 1' } } }
    ]
  };

  it('renames a variable no expression uses, with its Get and Set nodes', () => {
    const named = nameVariable(def, 0, 'Line Total');
    assert.deepEqual(named.variables[0], { name: 'lineTotal', type: 'number', default: 0 });
    assert.deepEqual(named.nodes[3]?.config, { name: 'lineTotal' });
  });

  it('keeps the key of a variable an expression uses, and labels it', () => {
    const named = nameVariable(withExpr, 0, 'Line Total');
    assert.deepEqual(named.variables[0], {
      name: 'count',
      type: 'number',
      default: 0,
      label: 'Line Total'
    });
    assert.deepEqual(named.nodes, withExpr.nodes);
  });
});

describe('setVariables', () => {
  it('removes the Get and Set nodes of a variable that is gone', () => {
    assert.ok(!setVariables(def, catalog, []).def.nodes.some((n) => n.id === 'get1'));
  });
});

describe('renamePinNamed', () => {
  it('renames the pin with that key, and ignores one that is gone', () => {
    assert.equal(
      renamePinNamed(def, 'outputs', 'loose', 'Free Text').signature.outputs[1]?.name,
      'freeText'
    );
    assert.equal(renamePinNamed(def, 'outputs', 'nope', 'X'), def);
  });
});
