import { classNamesOf } from '../class-names.ts';

const barDelays = [
  '[animation-delay:0ms]',
  '[animation-delay:120ms]',
  '[animation-delay:240ms]',
  '[animation-delay:360ms]'
] as const;

const SpinnerBars = () =>
  barDelays.map((delay) => (
    <span
      key={delay}
      className={classNamesOf('animate-bars h-full flex-1 rounded-full bg-current', delay)}
    />
  ));

export const Spinner = () => (
  <span
    role="status"
    aria-label="Loading"
    className="animate-reveal text-primary flex h-10 w-12 items-center gap-1.5"
  >
    <SpinnerBars />
  </span>
);

export const PendingOverlay = () => (
  <span aria-hidden="true" className="absolute inset-0 m-auto flex h-4 w-5 items-center gap-0.5">
    <SpinnerBars />
  </span>
);
