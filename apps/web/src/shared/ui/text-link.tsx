import { classNamesOf } from '../class-names.ts';
import { Link, type LinkProps } from '../router.tsx';
import { interactiveClasses } from './interactive.ts';

export const textLinkClasses = classNamesOf(
  'text-primary rounded-lg font-medium underline-offset-2 hover:underline',
  interactiveClasses
);

export const TextLink = (props: Omit<LinkProps, 'className'>) => (
  <Link className={textLinkClasses} {...props} />
);
