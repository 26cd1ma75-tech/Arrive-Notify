import type { GroupCategory } from './types';

export const GROUP_CATEGORIES: { key: GroupCategory; label: string; icon: string }[] = [
  { key: 'family', label: 'Family', icon: '\u{1F46A}' },
  { key: 'friends', label: 'Friends', icon: '\u{1F91D}' },
  { key: 'office', label: 'Office', icon: '\u{1F4BC}' },
  { key: 'college', label: 'College', icon: '\u{1F393}' },
  { key: 'custom', label: 'Custom', icon: '\u{2B50}' },
];

export const GROUP_ICONS = [
  '\u{1F46A}', '\u{1F91D}', '\u{1F4BC}', '\u{1F393}', '\u{2B50}',
  '\u{1F3E0}', '\u{1F6A8}', '\u{2764}\u{FE0F}', '\u{26BD}', '\u{1F3B5}',
];

export const categoryIcon = (c: GroupCategory) => GROUP_CATEGORIES.find((x) => x.key === c)?.icon ?? '\u{2B50}';
