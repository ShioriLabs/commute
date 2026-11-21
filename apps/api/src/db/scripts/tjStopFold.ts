/*
 * Directional sister haltes the 2026-11 TransJakarta feed added on corridor
 * 3H. The official poster draws each of these as ONE halte, so they fold back
 * onto the halte the poster (and our runtime/headway data) already uses.
 */
export const TJ_STOP_FOLD: Record<string, string> = {
  H00277P: 'H00278P', // Harmoni Arah Utara -> Harmoni
  H00279P: 'H00280P', // Sawah Besar Arah Utara -> Sawah Besar
  H00282P: 'H00281P', // Mangga Besar Arah Selatan -> Mangga Besar
}

/*
 * Line colours where the feed disagrees with the poster. The 2026-11 feed
 * recoloured 7 and 7F brown (#914900); both posters print pink.
 */
export const TJ_COLOR_OVERRIDES: Record<string, string> = {
  7: 'E2285A',
  '7F': 'E2285A',
}
