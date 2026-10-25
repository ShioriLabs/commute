# Japanese IC cards

The app reads a Japanese transit IC card the way it reads a KMT: balance in yen on the card's face,
and a history. The page also shows a joke, since the card is no use in Jakarta.

A rail ride is named by its line, with its operator underneath, all in Japanese. When the line's
code covers more than one line, the ride is named by its operator instead ("東日本旅客鉄道").
Anything else shows as money in ("Top Up") or money out ("Pembayaran"). The card's purchase shows
as "Pembelian Kartu".

This file is the source for every fact the reader uses about the card. They all come from one dump
of our own PASMO, taken with the debug dumper on 2026-10-23 (note "PASMO beneran", S23). No other
reader's code was consulted. The line names are the one outside source (see "Line names").

## Telling the card apart

Android finds the card on system `0003`, and it isn't a KMT (`90B7`). The dump's `tag.systemCode`
is `0003`.

## Purse: service `008B`, block 0, no key

| Bytes | Meaning | In the dump |
| --- | --- | --- |
| D11–12 | Balance in yen, little-endian | Block `00000000000000002000003B00000005`: `3B 00` = ¥59 |

## History: service `090F`, 20 blocks, no key

Newest first. The newest slot's balance matches the purse.

| Bytes | Meaning |
| --- | --- |
| D4–5 | The day, big-endian: 7 bits of year since 2000, then 4 bits of month, then 5 bits of day. An unused slot has `0000` here. |
| D10–11 | The balance after the entry, in yen, little-endian |

The dump's three used slots:

| Slot | Block | Day | Balance after |
| --- | --- | --- | --- |
| 0 | `1601000232AA2D202D223B0000000500` | `32AA` = 2025-05-10 | ¥59 |
| 1 | `1701000232AA2D1A2D20020100000300` | `32AA` = 2025-05-10 | ¥258 |
| 2 | `0807000032A800000000F40100000100` | `32A8` = 2025-05-08 | ¥500 |

The other 17 slots read `00000080000000000000000000000000`.

A slot holds no amount and no time of day. The reader works out each amount as the slot's balance
less the balance of the slot before it, so the dump gives −¥199, −¥242 and then +¥500.

**Checked against the card's own history** (2026-10-25). The user's other app lists this card as
follows, all on JR East:

| Day | Entry | Fare |
| --- | --- | --- |
| May 8 | Card issued | |
| May 10 | Ashikaga Flower Park → Iwafune | ¥242 |
| May 10 | Iwafune → Tochigi | ¥199 |

That confirms three things:
- the day layout
- newest first
- the amounts worked out from the balances

It also shows that D6–7 is the entry station and D8–9 the exit station:

| Code | Station |
| --- | --- |
| `2D1A` | Ashikaga Flower Park |
| `2D20` | Iwafune (in both rides) |
| `2D22` | Tochigi |

Each code's first byte is the line, which is all the reader looks up (D6 for the way in, D8 for
the way out). It looks lines up only on slots whose D0 is `16` or `17`, the two rides we've seen.
Other kinds of slot might use D6–9 for something else.

Slot 2, with D0 `08` where the rides have `16` and `17`, is the card being issued with ¥500 on it.
The reader shows a slot with D0 `08` as "Pembelian Kartu". This rests on one card.

Nothing in the dump names an operator. D0–3 is identical across the two rides. The operator comes
from the line table instead.

The gate-tap service `108F` holds what looks like the time of each tap: hh and mm as plain decimal
at D8–9 (`1502` and `1514` for Iwafune in and Tochigi out). It also holds the fare at D10–11,
little-endian (`C7 00` = ¥199, `F2 00` = ¥242). The reader doesn't use either.

**Assumptions, unverified:**
- A history with free slots starts from an empty card. So its oldest entry counts from ¥0, and the
  issue reads as a ¥500 top-up.
- In a full history, the oldest entry has nothing to count from, so the reader leaves it out.
- The other mutual-use cards (Suica, ICOCA and the rest) share PASMO's layout, since only PASMO has
  been dumped. If one doesn't, its figures come out wrong, which is harmless for a joke.

## Line names

`impl/src/main/assets/japan_ic/lines.csv` is cut down from Suica Viewer's station table, with the
table's licence beside it (`LICENSE`).

- **Source:** https://github.com/soltia48/suica-viewer, `assets/station_codes.csv`, at commit
  `df256abd66b62c2d9681dbb29519eb9315205f84` (2026-07-24).
- **Source's SHA-256:** `BB931D56F3186765C0186797ED1AC59E2FA55AF2FB8528EB052E481DF1632B8F`.
- **Licence:** MIT, © 2025 KIRISHIKI Yudai. It's credited in the app under Atribusi Data.

The station table's columns are area, line and station code (hex), then company, line name, station
name and notes, all in Japanese. Only the notes column is ever quoted. It has 6,958 stations on 357
area-and-line codes and 75 KB compressed, so the app ships only the lines (about 4 KB). To make the
cut-down table:

```sh
awk -F, -f japan_ic_lines.awk station_codes.csv > ../impl/src/main/assets/japan_ic/lines.csv
```

That leaves one row per area and line code: area, line, company, and the line's name.

Before we used it, the full table was checked against our ride history above. It names `2D1A`,
`2D20` and `2D22` as あしかがフラワーパーク, 岩舟 and 栃木 on 東日本旅客鉄道, which matches the user's
own records.

What the table shows about codes:
- **Company:** every code belongs to one company. The script fails if that ever changes.
- **Line name:** a code doesn't always name one line. 89 of the 357 codes cover several lines,
  including our own `2D` (両毛線 and 水戸線), so those are left blank. Codes run by line from JNR
  days, not by company. JR East alone has `01–05`, `12–13`, `15–1F` and more, with other companies
  in between, so no simple rule could take the place of the table.

How the reader uses it:
- **Area 0 only.** The table keys lines by area as well. Our one card doesn't show where a slot
  keeps its area, and its stations are all in area 0. A card from another area could get a wrong
  name until a dump shows where the area is kept.
- **Display.** A ride's title is its line ("from → to" when it changed lines), with the company
  underneath. With no line name, the company is the title. A ride between two companies shows
  "company → company".

**Caveat:** Suica Viewer's README doesn't say where the table was compiled from. The MIT grant is
its author's. If the data came from an older community table, its first source's terms are
unknown.

The card's other services aren't used and aren't written up here. Retail
e-money cards (nanaco, WAON, Edy) use a different system, and get the ordinary "can't read this
card" message.
