export const PICK_LISTS = [
  'impression',
  'symptom',
  'cause-of-injury',
  'incident-location-type',
  'procedure',
  'medication',
  'medical-surgical-history',
  'medication-allergy',
  'environmental-food-allergy',
  'patient-activity'
] as const;

export type PickList = (typeof PICK_LISTS)[number];

export const isPickList = (x: unknown): x is PickList => PICK_LISTS.includes(x as PickList);
