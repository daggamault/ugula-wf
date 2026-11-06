import type { CodeDescriptions, PricedLine } from '@ugula/billing';
import { formatCents } from '../format.ts';
import { Table, TableCell, TableRow } from '../ui/table.tsx';
import { CodeText } from './code-text.tsx';

export const ChargeLines = ({
  lines,
  codes = {}
}: {
  lines: readonly PricedLine[];
  codes?: CodeDescriptions;
}) => (
  <Table
    label="Claim lines"
    head={['HCPCS', { label: 'Units' }, { label: 'Unit Price' }, { label: 'Amount' }]}
  >
    {lines.map((l, i) => (
      <TableRow key={`${i}-${l.code}`}>
        <TableCell kind="wrap">
          <CodeText codes={codes} set="hcpcs" code={l.code} />
        </TableCell>
        <TableCell kind="numeric">{l.units}</TableCell>
        <TableCell kind="numeric" isMuted>
          {formatCents(l.unitCents)}
        </TableCell>
        <TableCell kind="numeric">{formatCents(l.totalCents)}</TableCell>
      </TableRow>
    ))}
  </Table>
);
