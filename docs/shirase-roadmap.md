# shirase roadmap: the best basemap of Jakarta

shirase (`apps/shirase`) is Peta Bus's basemap, live at `shirase.commute.shiorilabs.id` since 2026-11-18 (`roads-v1`, sprites `commute-{light,dark}-v1`). This is the plan for making it the best *basemap* of Jakarta: the streets, busways, medians, footbridges and stations under the transit, drawn better than anyone else draws them.

It isn't trying to be the best *map*. Google wins on places: businesses with hours, reviews, photos and popular times, kept current by owners and users. That's a data operation, not cartography, and shirase stays out of it. It labels landmarks only, and leaves "where's a good coffee" to Google.

## Why it can win

Map detail follows a company's home market. Yandex draws Moscow down to individual trees, traffic lights and building entrances. Naver and Kakao draw Seoul junctions with every crossing and U-turn. Google gives Akihabara crossings, kerbs and signals. Jakarta gets the generic treatment everywhere: on Google, Rasuna Said is one flat band, with no busway, no median, and haltes as pins.

Jakarta is shirase's home market. It already draws what nobody else does:
- separate carriageways, and TransJakarta busways in red;
- medians from recon;
- footbridges with their stairs;
- traffic islands.

Our edge is the same as Yandex's: local knowledge, fed in as recon notes.

## Quick wins (OSM already has the data)

1. **Zebra crossings and traffic lights.** Crossings come from `footway=crossing` ways and crossing nodes, painted in the bake; signals are `highway=traffic_signals` nodes, drawn as small icons at junctions. These are what Google's detailed Tokyo and Naver's Seoul junctions have, and shirase doesn't yet. Jakarta's main roads have them mapped fairly well.
2. **Trees.** `natural=tree` points as small round symbols, up close. Sudirman and Thamrin are well mapped; it costs little and looks great.
3. **Mall footprints tinted.** Grand Indonesia, Plaza Indonesia and Pacific Place stand out, the way Apple marks malls.

## Making the city read right

4. **Divided roads merged citywide.** Same-name carriageway pairing everywhere: 80% of one-way main-road length pairs, and 92–100% on the main roads. Each pair becomes one road with one name, and a median that is a plain divider by default (1.5 m, Apple's `#42495b` in dark) and green at its own width where recon says so.
   - **Toll-road medians** (Gatsu, MT Haryono, TB Simatupang) are left for later. Merging there would pave over the toll.
   - Today this is spec stretches only. See `apps/shirase/src/jp-roads.json` → `merge`.
5. **Rail as one named line.** Double track drawn as one centred line per route (KRL, MRT, LRT), named from OSM's route relations, as Google draws the LRT and Naver Line 2.
6. **Halte platforms in the median.** TransJakarta haltes as islands in the middle of the road, reached by the footbridges shirase already draws. This is the city's signature, and no other map draws it. Check first whether OSM maps the haltes as `public_transport=platform` areas.

## Transit depth (together with Peta Bus)

7. **Numbered MRT exits.** Exit numbers at stations, from Commute's exit data, as Naver numbers subway exits.
8. **Peta Bus's own lines and stations.** One line per route in the `commute-overlay` slot. The basemap's `roads_rail` and station POIs give way to the app's own, client-side first and later as a style option (for example `/styles/light.json?transit=app`), so web and Android don't hard-code Protomaps layer ids.

## Signature pieces

9. **3D landmarks.** Monas, Istiqlal and Katedral, modelled low-poly in Blender, as glTF on a MapLibre custom layer over shirase. Yandex's Kremlin is the bar.

## Ongoing

- **Recon.** Each stretch noted as name, from, to, median type and width becomes a line in the `merge` spec.
- **Small fixes:** the light-theme divider colour (a guess until checked against a light Apple screenshot), and a slight kink where a traffic island joins its median strip.
- **Releases.** Local iterations are named `roads-dev-vN`. Only a build that ships takes the next release name (`roads-v2`, …). Sprites are immutable for 30 days, so never reuse a released sprite name.

## Suggested order

Crossings and traffic lights first (small and very visible), then halte platforms (the defining Jakarta feature, and they feed straight into Peta Bus).

## References

- **Korea:** Naver and Kakao on Gangnam-daero and the POSCO crossroads (`강남대로`, `포스코사거리`) for median bus stops, crossings, U-turns and numbered exits.
- **Moscow:** Yandex for the high bar.
- **Tokyo:** Google's detailed Akihabara for crossings, kerbs and signals.
- **Quiet basemaps for overlays:** Citymapper, CARTO Positron and Dark Matter.
