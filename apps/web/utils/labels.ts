/*
 * Middot rather than "/" for lists of station names and platform numbers.
 * A slash reads as "or" and collides with the way stations sign a shared
 * island platform ("1/2"), so a direction label joined with slashes looked
 * like one more platform code. The middot separates without asserting a
 * relationship, and it is narrower — which matters because these labels
 * truncate beside the platform badge.
 */
export const LABEL_SEPARATOR = ' · '

/** Joins station names for a direction label: ['A','B'] -> 'A · B'. */
export function joinLabels(labels: string[]): string {
  return labels.join(LABEL_SEPARATOR)
}

/**
 * Renders a curated platform code for display. Values are stored in the GTFS
 * bare form ("3/4"); stations sign these as a range on one island platform, so
 * the separator is tightened rather than spaced.
 */
export function formatPlatformCode(code: string): string {
  return code.replace(/\s*\/\s*/g, '·')
}
