import type { FieldSpec, Json } from '@ugula/graph';
import {
  ArrowRightIcon,
  BadgeDollarSignIcon,
  BanIcon,
  BuildingIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleSlashIcon,
  ClockIcon,
  FileClockIcon,
  FilePenIcon,
  FilePlusIcon,
  GavelIcon,
  HandCoinsIcon,
  LandmarkIcon,
  LinkIcon,
  type LucideIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SaveIcon,
  SendIcon,
  SkipForwardIcon,
  ThumbsDownIcon,
  Trash2Icon,
  UndoIcon,
  UserCheckIcon,
  UserIcon,
  UserPlusIcon,
  UserRoundIcon,
  WalletIcon,
  XIcon
} from 'lucide-react';
import { titleCaseLabel } from '../../shared/format.ts';
import { titleCase } from '../../shared/task-queues.ts';
import { labelOf } from './context-view.tsx';

type OutcomeStyle = { icon: LucideIcon; label?: string };

const OUTCOMES: Readonly<Record<string, OutcomeStyle>> = {
  approve: { icon: CheckIcon },
  hold: { icon: PauseIcon },
  release: { icon: PlayIcon },
  void: { icon: BanIcon },
  skip: { icon: SkipForwardIcon },
  claim: { icon: ReceiptTextIcon, label: 'Make Claim' },
  skipClaim: { icon: SkipForwardIcon, label: 'Skip Claim' },
  useSelected: { icon: UserCheckIcon, label: 'Use Selected Patient' },
  createNew: { icon: UserPlusIcon, label: 'Create New Patient' },
  savePatient: { icon: SaveIcon, label: 'Save Patient' },
  link: { icon: LinkIcon, label: 'Link Payer' },
  unlisted: { icon: CircleHelpIcon, label: 'Mark Unlisted' },
  remove: { icon: Trash2Icon, label: 'Remove Payer' },
  price: { icon: BadgeDollarSignIcon, label: 'Set Price' },
  save: { icon: SaveIcon },
  backToReview: { icon: UndoIcon },
  apply: { icon: RefreshCwIcon, label: 'Apply Update' },
  acknowledge: { icon: CheckCheckIcon },
  restart: { icon: RotateCcwIcon },
  fixData: { icon: PencilIcon, label: 'Fix Claim Data' },
  skipPayer: { icon: SkipForwardIcon },
  selfPay: { icon: UserIcon, label: 'Patient Pays' },
  submitted: { icon: SendIcon, label: 'Mark Submitted' },
  continue: { icon: ArrowRightIcon },
  writeOff: { icon: CircleSlashIcon },
  resubmitCorrected: { icon: FilePenIcon, label: 'Resubmit Corrected' },
  refunded: { icon: HandCoinsIcon, label: 'Refund Recorded' },
  keepCredit: { icon: WalletIcon },
  resubmit: { icon: RotateCwIcon },
  keepWaiting: { icon: ClockIcon },
  nextPayer: { icon: SkipForwardIcon },
  sendToCollections: { icon: LandmarkIcon },
  correctClaim: { icon: FilePenIcon, label: 'Correct Claim' },
  appeal: { icon: GavelIcon, label: 'Appeal' },
  billAnotherPayer: { icon: BuildingIcon, label: 'Bill Another Payer' },
  moveToPatient: { icon: UserRoundIcon, label: 'Move to Patient' },
  sent: { icon: SendIcon, label: 'Mark Sent' },
  notAppealing: { icon: XIcon, label: 'Do Not Appeal' },
  upheld: { icon: ThumbsDownIcon, label: 'Denial Upheld' },
  withdrawn: { icon: UndoIcon, label: 'Withdraw Appeal' },
  requested: { icon: SendIcon, label: 'Mark Requested' },
  cannotReopen: { icon: XIcon, label: 'Cannot Reopen' },
  cannotSend: { icon: XIcon, label: 'Cannot Send' },
  refund: { icon: HandCoinsIcon, label: 'Approve Refund' },
  reject: { icon: XIcon },
  done: { icon: CheckIcon, label: 'Done' },
  retry: { icon: RotateCcwIcon },
  cancel: { icon: XIcon },
  post: { icon: HandCoinsIcon, label: 'Post Payment' },
  add: { icon: FilePlusIcon, label: 'Add Document' },
  log: { icon: FileClockIcon, label: 'Log Request' },
  chase: { icon: SendIcon, label: 'Start Chase' },
  billFacility: { icon: BuildingIcon, label: 'Bill Facility' },
  billPayers: { icon: LandmarkIcon, label: 'Bill Payers' }
};

// Fallbacks for workflows that do not give hints, only for outcomes that mean
// the same thing in every task. Words like continue, save or cancel do not.
const HINTS: Readonly<Record<string, string>> = {
  void: 'Closes the claim as void; it is never billed.',
  writeOff: 'Writes off the balance left and closes the claim.',
  skipPayer: 'Does not bill this payer; bills the next payer, or the patient if none is left.',
  selfPay: 'Bills the patient; no payer is billed.',
  submitted: 'Records that it went to the payer another way.',
  keepWaiting: 'Waits longer for an answer; this task comes back if none arrives.',
  sendToCollections: 'Sends the balance to collections.',
  moveToPatient: 'Moves the balance to the patient.',
  keepCredit: 'Keeps the credit on the claim; no refund is sent.'
};

export const outcomeHint = (
  task: { hints?: Readonly<Record<string, string>> | null },
  outcome: string
) =>
  (task.hints && Object.hasOwn(task.hints, outcome) ? task.hints[outcome] : null) ??
  (Object.hasOwn(HINTS, outcome) ? HINTS[outcome] : null) ??
  null;

const DESTRUCTIVE = new Set(['void', 'writeOff']);

const styleOf = (outcome: string) => (Object.hasOwn(OUTCOMES, outcome) ? OUTCOMES[outcome] : null);

export const outcomeLabel = (outcome: string) => styleOf(outcome)?.label ?? titleCase(outcome);

export const outcomeIcon = (outcome: string) => styleOf(outcome)?.icon ?? CircleCheckIcon;

// Cancel only ends something for good on a stuck run; in a form it changes nothing.
export const isDestructive = (outcome: string, kind: 'task' | 'fault' = 'task') =>
  DESTRUCTIVE.has(outcome) || (kind === 'fault' && outcome === 'cancel');

export const fieldLabel = (f: Pick<FieldSpec, 'name' | 'label'>) =>
  f.label ? titleCaseLabel(f.label) : labelOf(f.name);

const isBlank = (value: Json | undefined) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && !value.length);

export const missingFor = (
  fields: readonly FieldSpec[],
  values: Readonly<Record<string, Json>>,
  outcome: string
) => fields.filter((f) => f.required?.includes(outcome) && isBlank(values[f.name]));

export const missingReason = (missing: readonly FieldSpec[]) =>
  missing.length ? `Fill in ${missing.map(fieldLabel).join(', ')} first.` : undefined;

export const consequenceOf = (
  task: { hints?: Readonly<Record<string, string>> | null },
  outcome: string
) =>
  `${outcomeHint(task, outcome) ?? 'The workflow continues from this choice.'} This cannot be undone.`;
