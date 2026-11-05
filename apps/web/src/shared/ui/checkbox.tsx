import type { InputHTMLAttributes } from 'react';
import { classNamesOf } from '../class-names.ts';
import { interactiveClasses } from './interactive.ts';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>;

export const Checkbox = (props: CheckboxProps) => (
  <input
    type="checkbox"
    className={classNamesOf(
      interactiveClasses,
      'accent-primary size-4 rounded enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:size-5'
    )}
    {...props}
  />
);
