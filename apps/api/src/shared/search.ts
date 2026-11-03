import * as v from 'valibot';

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export const containsPattern = (text: string) => `%${escapeLike(text.trim().toLowerCase())}%`;

export const searchText = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80)));
