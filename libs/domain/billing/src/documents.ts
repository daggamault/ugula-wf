import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { money } from './statements.ts';

export type DocumentRow = { label: string; value: string };

export type DocumentSection = { heading: string; rows: DocumentRow[] };

export type DocumentSpec = {
  title: string;
  subtitle: string;
  issuedOn: string;
  from: string[];
  to: string[];
  sections: DocumentSection[];
};

const PAGE: [number, number] = [612, 792];
const LEFT = 50;
const RIGHT = 562;
const TOP = 740;
const BOTTOM = 60;
const LINE = 14;
const WRAP = 95;

const printable = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '');

export const wrap = (text: string, width = WRAP) =>
  printable(text)
    .split(/\s+/)
    .filter(Boolean)
    .reduce<string[]>((lines, word) => {
      const last = lines.at(-1);
      if (last !== undefined && `${last} ${word}`.length <= width) {
        lines[lines.length - 1] = `${last} ${word}`;
      } else {
        lines.push(word);
      }
      return lines;
    }, []);

export const renderDocument = async (spec: DocumentSpec): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  pdf.setTitle(printable(`${spec.title} - ${spec.subtitle}`));
  pdf.setProducer('ugula');
  pdf.setCreationDate(new Date(`${spec.issuedOn}T00:00:00Z`));
  pdf.setModificationDate(new Date(`${spec.issuedOn}T00:00:00Z`));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  let page: PDFPage = pdf.addPage(PAGE);
  let y = TOP;
  const ensure = (lines: number) => {
    if (y - lines * LINE >= BOTTOM) return;
    page = pdf.addPage(PAGE);
    y = TOP;
  };
  const text = (value: string, x: number, size = 10, font: PDFFont = regular, color = ink) =>
    page.drawText(printable(value), { x, y, size, font, color });
  const right = (value: string, size = 10, font: PDFFont = regular) =>
    text(value, RIGHT - font.widthOfTextAtSize(printable(value), size), size, font);
  for (const [i, line] of spec.from.entries()) {
    text(line, LEFT, i === 0 ? 14 : 10, i === 0 ? bold : regular);
    y -= i === 0 ? 18 : 13;
  }
  y = TOP;
  right(spec.title.toUpperCase(), 14, bold);
  y -= 18;
  right(spec.subtitle);
  y -= 13;
  right(`Date: ${spec.issuedOn}`);
  y = Math.min(y, TOP - 18 - 13 * spec.from.length) - 30;
  for (const [i, line] of spec.to.entries()) {
    text(line, LEFT + 22, 11, i === 0 ? bold : regular);
    y -= LINE;
  }
  y -= 16;
  for (const section of spec.sections) {
    ensure(3);
    text(section.heading, LEFT, 12, bold);
    y -= 6;
    page.drawLine({
      start: { x: LEFT, y },
      end: { x: RIGHT, y },
      thickness: 0.5,
      color: muted
    });
    y -= LINE;
    for (const row of section.rows) {
      const lines = wrap(row.value, row.label ? 60 : WRAP);
      ensure(Math.max(lines.length, 1));
      if (row.label) text(row.label, LEFT, 10, bold);
      for (const line of lines.length ? lines : ['']) {
        text(line, row.label ? LEFT + 170 : LEFT);
        y -= LINE;
        ensure(1);
      }
    }
    y -= 10;
  }
  return pdf.save();
};

export const appendPdfs = async (first: Uint8Array, attachments: readonly Uint8Array[]) => {
  const merged = await PDFDocument.load(first);
  for (const bytes of attachments) {
    const attached = await PDFDocument.load(bytes).catch(() => null);
    if (!attached) continue;
    const pages = await merged.copyPages(attached, attached.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  return merged.save();
};

export type AgencyLetterhead = {
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string;
};

export const letterhead = (a: AgencyLetterhead) =>
  [
    a.name,
    a.addressLine ?? '',
    [[a.city, a.state].filter(Boolean).join(', '), a.postalCode].filter(Boolean).join(' '),
    `Phone: ${a.phone}`
  ].filter((l) => l.trim());

const titleOf = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

const shown = (x: unknown): string | null =>
  typeof x === 'string'
    ? x.trim() || null
    : typeof x === 'number' || typeof x === 'boolean'
      ? String(x)
      : null;

export const fieldSections = (
  fields: unknown,
  heading = 'Patient Care Report'
): DocumentSection[] => {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return [];
  const entries = Object.entries(fields);
  const rowsOf = (x: unknown): DocumentRow[] =>
    Array.isArray(x)
      ? x.flatMap(rowsOf)
      : typeof x === 'object' && x !== null
        ? Object.entries(x).flatMap(([k, v]) => {
            const value = shown(v);
            return value ? [{ label: titleOf(k), value }] : rowsOf(v);
          })
        : [];
  const top = entries.flatMap(([k, v]) => {
    const value = shown(v);
    return value ? [{ label: titleOf(k), value }] : [];
  });
  return [
    ...(top.length ? [{ heading, rows: top }] : []),
    ...entries.flatMap(([k, v]) => {
      const rows = shown(v) ? [] : rowsOf(v);
      return rows.length ? [{ heading: titleOf(k), rows }] : [];
    })
  ];
};

export type AppealPacketSource = {
  agency: AgencyLetterhead;
  payer: string;
  level: string;
  dueOn: string | null;
  claim: DocumentRow[];
  report: DocumentSection[];
  attachments: Uint8Array[];
};

export const renderAppealPacket = async (s: AppealPacketSource, issuedOn: string) =>
  appendPdfs(
    await renderDocument({
      title: s.level,
      subtitle: s.dueOn ? `Due by ${s.dueOn}` : 'Appeal',
      issuedOn,
      from: letterhead(s.agency),
      to: [s.payer, 'Appeals'],
      sections: [
        {
          heading: 'Request',
          rows: [
            {
              label: '',
              value: `We request a ${s.level.toLowerCase()} of the claim below. The patient care report and the documents on file support the service billed.`
            }
          ]
        },
        { heading: 'Claim', rows: s.claim },
        ...s.report
      ]
    }),
    s.attachments
  );

export type InvoicedClaim = {
  claimId: string;
  number: number;
  pcrNumber: string | null;
  patient: string;
  serviceDate: string | null;
  chargeCents: number;
  balanceCents: number;
};

export type FacilityInvoiceSource = {
  facilityId: string;
  agency: AgencyLetterhead;
  facility: string[];
  period: string;
  claims: InvoicedClaim[];
};

export const invoiceTotal = (claims: readonly InvoicedClaim[]) =>
  claims.reduce((sum, c) => sum + c.balanceCents, 0);

export const renderFacilityInvoice = (s: FacilityInvoiceSource, issuedOn: string) =>
  renderDocument({
    title: 'Facility Invoice',
    subtitle: `Services in ${s.period.slice(0, 7)}`,
    issuedOn,
    from: letterhead(s.agency),
    to: s.facility,
    sections: [
      {
        heading: 'Transports',
        rows: s.claims.map((c) => ({
          label: `Claim #${c.number}`,
          value: `${[c.pcrNumber, c.patient, c.serviceDate].filter(Boolean).join(' · ')}: charges ${money(c.chargeCents)}, due ${money(c.balanceCents)}`
        }))
      },
      {
        heading: 'Amount Due',
        rows: [{ label: 'Total', value: money(invoiceTotal(s.claims)) }]
      }
    ]
  });
