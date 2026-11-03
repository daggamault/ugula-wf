import type { FieldSpec, Json } from '@ugula/graph';
import {
  ArrowRightIcon,
  BadgeDollarSignIcon,
  BanIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleSlashIcon,
  ClockIcon,
  FilePenIcon,
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
  Trash2Icon,
  UndoIcon,
  UserCheckIcon,
  UserIcon,
  UserPlusIcon,
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
  retry: { icon: RotateCcwIcon },
  cancel: { icon: XIcon }
};

const DESTRUCTIVE = new Set(['void', 'writeOff', 'cancel']);

const styleOf = (outcome: string) => (Object.hasOwn(OUTCOMES, outcome) ? OUTCOMES[outcome] : null);

export const outcomeLabel = (outcome: string) => styleOf(outcome)?.label ?? titleCase(outcome);

export const outcomeIcon = (outcome: string) => styleOf(outcome)?.icon ?? CircleCheckIcon;

export const isDestructive = (outcome: string) => DESTRUCTIVE.has(outcome);

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

const CONSEQUENCES: Readonly<Record<string, string>> = {
  void: 'The claim closes as void and is never billed.',
  writeOff: 'The balance left on the claim is written off and the claim closes.',
  cancel: 'The run stops for good and does not continue.'
};

export const consequenceOf = (outcome: string) =>
  `${(Object.hasOwn(CONSEQUENCES, outcome) ? CONSEQUENCES[outcome] : null) ?? 'The workflow continues from this choice.'} This cannot be undone.`;
