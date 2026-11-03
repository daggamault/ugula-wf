const isa = (control: string) =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'DEMOCH'.padEnd(15)}*ZZ*${'DEVEMS01'.padEnd(15)}*261103*1200*^*00501*${control}*0*T*:~`;

const interchange = (control: string, gs: string, segments: readonly string[]) =>
  [
    isa(control),
    `${gs}~`,
    ...segments.map((s) => `${s}~`),
    `GE*1*${Number(control)}~`,
    `IEA*1*${control}~`,
    ''
  ].join('\n');

const control = () => String(Math.floor(Math.random() * 900_000_000) + 100_000_000);

const dollars = (cents: number) => (cents / 100).toFixed(2);

export const eligibility271 = (trace: string, active: boolean) => {
  const n = control();
  return interchange(n, `GS*HB*DEMOCH*DEVEMS01*20261103*1200*${Number(n)}*X*005010X279A1`, [
    'ST*271*0001*005010X279A1',
    'BHT*0022*11*E2E*20261103*1200',
    'HL*1**20*1',
    'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
    'HL*2*1*21*1',
    'NM1*1P*2*DEVELOPMENT EMS*****XX*1234567893',
    'HL*3*2*22*0',
    `TRN*2*${trace}*9123456789`,
    'NM1*IL*1*KLINE*DOROTHY****MI*2KT7XM4RW91',
    active ? 'EB*1**30**MEDICARE PART B' : 'EB*6**30',
    ...(active ? [] : ['MSG*Coverage terminated 2026-08-31']),
    `SE*${active ? 11 : 12}*0001`
  ]);
};

export const batchAcknowledgment999 = (batchControl: number, accepted: boolean) => {
  const n = control();
  return interchange(n, `GS*FA*DEMOCH*DEVEMS01*20261103*1200*${Number(n)}*X*005010X231A1`, [
    'ST*999*0001*005010X231A1',
    `AK1*HC*${batchControl}*005010X222A1`,
    'AK2*837*0001*005010X222A1',
    ...(accepted ? [] : ['IK3*NM1*12*2010*8', 'IK4*9**7']),
    `IK5*${accepted ? 'A' : 'R'}`,
    `AK9*${accepted ? 'A' : 'R'}*1*1*${accepted ? 1 : 0}`,
    `SE*${accepted ? 6 : 8}*0001`
  ]);
};

export const claimAcknowledgment277 = (claimNumber: number, rejection: string | null) => {
  const n = control();
  return interchange(n, `GS*HN*DEMOCH*DEVEMS01*20261103*1200*${Number(n)}*X*005010X214`, [
    'ST*277*0001*005010X214',
    'BHT*0085*08*E2E*20261103*1200*TH',
    'HL*1**20*1',
    'NM1*AY*2*DEMO CLEARINGHOUSE*****46*DEMOCH',
    'HL*2*1*21*1',
    'NM1*41*2*DEVELOPMENT EMS*****46*DEVEMS01',
    'HL*3*2*19*1',
    'NM1*85*2*DEVELOPMENT EMS*****XX*1234567893',
    'HL*4*3*PT',
    'NM1*QC*1*KLINE*DOROTHY',
    `TRN*2*${claimNumber}`,
    rejection ? `STC*A7:21*20261103*U*0********${rejection}` : 'STC*A2:20*20261103*WQ*0',
    'REF*1K*MCR-E2E-1',
    'SE*13*0001'
  ]);
};

export const remittance835 = (claimNumber: number, chargeCents: number, paidCents: number) => {
  const n = control();
  return interchange(n, `GS*HP*DEMOCH*DEVEMS01*20261103*1200*${Number(n)}*X*005010X221A1`, [
    'ST*835*0001',
    `BPR*I*${dollars(paidCents)}*C*ACH*CCP*01*1*DA*1*1**01*1*DA*1*20261103`,
    `TRN*1*EFT-${n}*1`,
    'N1*PR*MEDICARE*XV*DEMOMCR',
    'N1*PE*DEVELOPMENT EMS*XX*1234567893',
    'LX*1',
    `CLP*${claimNumber}*1*${dollars(chargeCents)}*${dollars(paidCents)}*0*MB*MCR-E2E-1`,
    `CAS*CO*45*${dollars(chargeCents - paidCents)}`,
    'SE*9*0001'
  ]);
};
