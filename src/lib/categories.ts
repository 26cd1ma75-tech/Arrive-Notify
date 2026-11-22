export const CATEGORIES = [
  { key: 'home', label: 'Home', emoji: '\u{1F3E0}' },
  { key: 'office', label: 'Office', emoji: '\u{1F3E2}' },
  { key: 'college', label: 'College', emoji: '\u{1F393}' },
  { key: 'gym', label: 'Gym', emoji: '\u{1F3CB}\u{FE0F}' },
  { key: 'other', label: 'Other', emoji: '\u{1F4CD}' },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

export const categoryOf = (key?: string | null) =>
  CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];

export const categoryRank = (key?: string | null) => {
  const i = CATEGORIES.findIndex((c) => c.key === key);
  return i === -1 ? CATEGORIES.length : i;
};
