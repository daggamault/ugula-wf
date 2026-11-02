import { PDFDocument, type PDFFont, rgb, StandardFonts } from 'pdf-lib';
import type { PricedLine } from './charges.ts';

export type MailingAddress = {
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type StatementPayment = {
  date: string;
  from: string;
  paidCents: number;
  adjustedCents: number;
};

export type StatementData = {
  number: number;
  issuedOn: string;
  agency: MailingAddress & { phone: string };
  patient: MailingAddress;
  reference: string;
  serviceDate: string | null;
  lines: PricedLine[];
  totalCents: number;
  payments: StatementPayment[];
  balanceCents: number;
};

export const HCPCS_LABELS: Record<string, string> = {
  A0425: 'Ground mileage, per statute mile',
  A0426: 'ALS1, non-emergency transport',
  A0427: 'ALS1, emergency transport',
  A0428: 'BLS, non-emergency transport',
  A0429: 'BLS, emergency transport',
  A0433: 'ALS2 transport',
  A0434: 'Specialty care transport',
  A0998: 'Ambulance response and treatment, no transport'
};

export const printable = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '');

export const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const zip = (z: string | null) =>
  z && z.length === 9 ? `${z.slice(0, 5)}-${z.slice(5)}` : (z ?? '');

const addressLines = (a: MailingAddress) =>
  [
    a.name,
    a.addressLine ?? '',
    [a.city, a.state].filter(Boolean).join(', ') + (a.postalCode ? ` ${zip(a.postalCode)}` : '')
  ].filter((l) => l.trim());

const phone = (p: string) =>
  /^\d{10}$/.test(p) ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;

export const renderStatement = async (s: StatementData): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  pdf.setTitle(printable(`Statement ${s.number} - ${s.patient.name}`));
  pdf.setProducer('ugula');
  pdf.setCreationDate(new Date(`${s.issuedOn}T00:00:00Z`));
  pdf.setModificationDate(new Date(`${s.issuedOn}T00:00:00Z`));
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  let y = 740;
  const text = (value: string, x: number, size = 10, font: PDFFont = regular, color = ink) =>
    page.drawText(printable(value), { x, y, size, font, color });
  const right = (value: string, edge: number, size = 10, font: PDFFont = regular) =>
    text(value, edge - font.widthOfTextAtSize(printable(value), size), size, font);
  const rule = () => {
    page.drawLine({
      start: { x: 50, y: y + 4 },
      end: { x: 562, y: y + 4 },
      thickness: 0.5,
      color: muted
    });
  };

  for (const [i, line] of addressLines(s.agency).entries()) {
    text(line, 50, i === 0 ? 14 : 10, i === 0 ? bold : regular);
    y -= i === 0 ? 18 : 13;
  }
  text(`Billing questions: ${phone(s.agency.phone)}`, 50, 10, regular, muted);
  y = 740;
  right('PATIENT STATEMENT', 562, 14, bold);
  y -= 18;
  for (const [label, value] of [
    ['Statement', `${s.number} of 3`],
    ['Date', s.issuedOn],
    ['Reference', s.reference],
    ['Date of service', s.serviceDate ?? 'Unknown']
  ] as const) {
    right(`${label}: ${value}`, 562);
    y -= 13;
  }

  y = 630;
  for (const [i, line] of addressLines(s.patient).entries()) {
    text(line, 72, 11, i === 0 ? bold : regular);
    y -= 14;
  }

  y = 540;
  text('Service', 50, 10, bold);
  right('Units', 400, 10, bold);
  right('Amount', 562, 10, bold);
  y -= 8;
  rule();
  y -= 12;
  for (const l of s.lines) {
    text(`${l.code}  ${HCPCS_LABELS[l.code] ?? 'Ambulance service'}`, 50);
    right(String(l.units), 400);
    right(money(l.totalCents), 562);
    y -= 15;
  }
  rule();
  y -= 12;
  text('Total charges', 50, 10, bold);
  right(money(s.totalCents), 562, 10, bold);
  y -= 15;
  for (const p of s.payments) {
    if (p.paidCents) {
      text(`${p.date}  Payment from ${p.from}`, 50);
      right(money(-p.paidCents), 562);
      y -= 15;
    }
    if (p.adjustedCents) {
      text(`${p.date}  Adjustment by ${p.from}`, 50);
      right(money(-p.adjustedCents), 562);
      y -= 15;
    }
  }
  rule();
  y -= 16;
  text('Amount due from patient', 50, 13, bold);
  right(money(s.balanceCents), 562, 13, bold);
  y -= 30;
  text(
    `Please call ${phone(s.agency.phone)} with insurance information or to arrange payment.`,
    50,
    10,
    regular,
    muted
  );
  return pdf.save();
};
