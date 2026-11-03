import * as v from 'valibot';

/** Escapes LIKE wildcards so user text matches literally. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** A lower-cased LIKE pattern that finds `text` anywhere in a value. */
export const containsPattern = (text: string) => `%${escapeLike(text.trim().toLowerCase())}%`;

/** The free-text `q` of a search query; blank is no search. */
export const searchText = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80)));
