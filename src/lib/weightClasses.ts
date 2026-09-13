// The 13 distinct `weight_class` values actually present in the dataset
// (confirmed by direct query, not guessed), weight-ordered for a nicer
// dropdown. Hardcoded rather than queried live on every page load since
// this list is stable — divisions are added rarely enough (last: Women's
// Featherweight) that a code change to add one is a reasonable bar.
export const WEIGHT_CLASSES = [
  "Women's Strawweight",
  "Women's Flyweight",
  "Flyweight",
  "Women's Bantamweight",
  "Bantamweight",
  "Women's Featherweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Openweight",
] as const;
