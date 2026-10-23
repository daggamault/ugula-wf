import { Link, type LinkProps } from '../router.tsx';

export const textLinkClasses = 'font-medium text-primary underline-offset-2 hover:underline';

export const TextLink = (props: Omit<LinkProps, 'className'>) => (
  <Link className={textLinkClasses} {...props} />
);
