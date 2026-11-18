import type { CodeDescriptions } from '@ugula/billing';
import { formatCents } from '../format.ts';
import { emptyValue } from '../ui/empty-state.tsx';
import { Table, TableCell, TableRow } from '../ui/table.tsx';
import { modifierCode } from './claim-data.tsx';
import type { ClaimLine } from './claim-detail.ts';
import { CodeLabel, CodeText } from './code-text.tsx';

export const ChargeLines = ({
  lines,
  codes = {}
}: {
  lines: readonly ClaimLine[];
  codes?: CodeDescriptions;
}) => (
  <Table
    label="Claim Lines"
    head={['HCPCS', 'Modifiers', { label: 'Units' }, { label: 'Unit Price' }, { label: 'Amount' }]}
  >
    {lines.map((l) => (
      <TableRow key={l.position}>
        <TableCell kind="wrap">
          <CodeText codes={codes} set="hcpcs" code={l.code} />
        </TableCell>
        <TableCell isMuted={!l.modifiers.length}>
          {l.modifiers.length
            ? l.modifiers.map((m) => <CodeLabel key={m} value={modifierCode(m)} isInline />)
            : emptyValue}
        </TableCell>
        <TableCell kind="numeric">{Number(l.units)}</TableCell>
        <TableCell kind="numeric" isMuted>
          {formatCents(l.unit_cents)}
        </TableCell>
        <TableCell kind="numeric">{formatCents(l.total_cents)}</TableCell>
      </TableRow>
    ))}
  </Table>
);
