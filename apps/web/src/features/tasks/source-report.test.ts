import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { SourceReport } from './client.ts';
import { SourceReportView } from './source-report.tsx';
import { fixtureDictionary, nemsis34Report } from './testing.ts';

const SOURCE: SourceReport = {
  report: {
    id: 'rep-1',
    position: 0,
    pcr_number: 'PCR-1',
    import_id: 'i1',
    file_name: 'october.xml',
    created_at: '2026-10-01T00:00:00Z'
  },
  data: {
    ePatient: { 'ePatient.17': '1980-01-02', 'ePatient.25': '9919001' },
    eOther: { 'eOther.22': 'Y' }
  },
  xml: '<PatientCareReport/>',
  dictionary: {
    elements: { 'eOther.22': 'File Attachment Name' },
    codes: { 'ePatient.25': { '9919001': 'Female' } }
  }
};

const show = (source: SourceReport = SOURCE) => {
  const toasts: ToastInput[] = [];
  const user = userEvent.setup();
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(SourceReportView, { source })
    )
  );
  return { toasts, user };
};

const panel = () => screen.getByRole('region', { name: 'Patient Care Report' });

describe('SourceReportView', () => {
  it('says which file the report came from and when', () => {
    show();
    assert.ok(
      within(panel()).getByText(
        `PCR-1 from october.xml, received ${formatDateTime('2026-10-01T00:00:00Z')}.`
      )
    );
  });

  it('names a report without a PCR number by its place in the file', () => {
    show({ ...SOURCE, report: { ...SOURCE.report, pcr_number: null, position: 2 } });
    assert.ok(
      screen.getByText(
        `Report #3 from october.xml, received ${formatDateTime('2026-10-01T00:00:00Z')}.`
      )
    );
  });

  it('leads with a readable summary of the report', () => {
    show({
      ...SOURCE,
      data: nemsis34Report,
      dictionary: fixtureDictionary
    });
    const name = screen.getByText('Wilhelmina Thorncastle');
    const toggle = screen.getByText('Show XML');
    assert.ok(name.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(screen.getAllByText('Patient Treated, Transported by this EMS Unit').length);
    assert.ok(screen.getByText('6.83 miles'));
  });

  it('keeps the XML, with NEMSIS labels and code meanings, behind a closed toggle', async () => {
    const { user } = show();
    const details = screen.getByText('Show XML').closest('details');
    assert.ok(details);
    assert.equal(details.open, false);
    await user.click(screen.getByText('Show XML'));
    assert.equal(details.open, true);
    const tree = within(details).getByRole('figure', { name: 'Source Report' });
    assert.ok(within(tree).getByText('Date of birth'));
    assert.ok(within(tree).getByText('File Attachment Name'));
    assert.ok(within(tree).getByText('Female'));
  });

  it('copies the XML and says so', async () => {
    const { toasts, user } = show();
    await user.click(screen.getByRole('button', { name: 'Copy XML' }));
    assert.equal(await navigator.clipboard.readText(), '<PatientCareReport/>');
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'XML copied to the clipboard' }]));
  });

  it('says why the XML could not be copied', async () => {
    const { toasts, user } = show();
    navigator.clipboard.writeText = async () => {
      throw new Error('denied');
    };
    await user.click(screen.getByRole('button', { name: 'Copy XML' }));
    await waitFor(() =>
      assert.deepEqual(toasts, [
        { intent: 'danger', title: 'Could not copy the XML', description: 'denied' }
      ])
    );
  });
});
