import { randomInt } from 'node:crypto';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const CHARACTERS = `${LETTERS}0123456789`;

const KEY_LENGTH = 10;

export const customKey = (pick: (max: number) => number = randomInt) =>
  `custom.${LETTERS[pick(LETTERS.length)]}${Array.from(
    { length: KEY_LENGTH - 1 },
    () => CHARACTERS[pick(CHARACTERS.length)]
  ).join('')}`;
