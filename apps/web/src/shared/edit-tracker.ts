export const createEditTracker = () => {
  let edits = 0;
  return {
    edit: () => {
      edits += 1;
    },
    mark: () => {
      const at = edits;
      return () => edits === at;
    }
  };
};
