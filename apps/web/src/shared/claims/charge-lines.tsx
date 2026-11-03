import type { PricedLine } from '@ugula/billing';
import { formatCents } from '../format.ts';
import { Table, TableCell, TableRow } from '../ui/table.tsx';

export const ChargeLines = ({ lines }: { lines: readonly PricedLine[] }) => (
  <Table
    label="Claim lines"
    head={['HCPCS', { label: 'Units' }, { label: 'Unit Price' }, { label: 'Amount' }]}
  >
    {lines.map((l, i) => (
      <TableRow key={`${i}-${l.code}`}>
        <TableCell>
          <span className="font-mono font-semibold">{l.code}</span>
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
