import type { CodeDescriptions, PricedLine } from '@ugula/billing';
import { formatCents } from '../format.ts';
import { emptyValue } from '../ui/empty-state.tsx';
import { Table, TableCell, TableRow } from '../ui/table.tsx';
import { CodeText, codeText } from './code-text.tsx';

export const ChargeLines = ({
  lines,
  codes = {},
  modifiers
}: {
  lines: readonly PricedLine[];
  codes?: CodeDescriptions;
  modifiers?: readonly (readonly string[])[] | undefined;
}) => (
  <Table
    label="Claim lines"
    head={[
      'HCPCS',
      ...(modifiers ? ['Modifiers'] : []),
      { label: 'Units' },
      { label: 'Unit Price' },
      { label: 'Amount' }
    ]}
  >
    {lines.map((l, i) => (
      <TableRow key={`${i}-${l.code}`}>
        <TableCell kind="wrap">
          <CodeText codes={codes} set="hcpcs" code={l.code} />
        </TableCell>
        {modifiers ? (
          <TableCell kind="wrap">
            {modifiers[i]?.length ? (
              <ul className="flex flex-col gap-0.5">
                {modifiers[i]?.map((m) => (
                  <li key={m}>{codeText(codes, 'modifier', m)}</li>
                ))}
              </ul>
            ) : (
              emptyValue
            )}
          </TableCell>
        ) : null}
        <TableCell kind="numeric">{l.units}</TableCell>
        <TableCell kind="numeric" isMuted>
          {formatCents(l.unitCents)}
        </TableCell>
        <TableCell kind="numeric">{formatCents(l.totalCents)}</TableCell>
      </TableRow>
    ))}
  </Table>
);
