export const unused = (store: string) => async () => {
  throw new Error(`The ${store} store is not used here`);
};
