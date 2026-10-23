type ClassValue = string | false | null | undefined;

export const classNamesOf = (...classes: readonly ClassValue[]): string =>
  classes.filter(Boolean).join(' ');
