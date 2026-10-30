# KMT (Kartu Multi Trip) layout

Everything below was worked out from our own card dumps, which were taken with the debug card
dumper and labelled by the card's owner with what they did at each tap. Nothing comes from
other card readers or their station tables. Where another reader disagrees, this file says so
but doesn't adopt its answer.

Generic FeliCa terms (service attributes, purse blocks, cyclic services) are as in `NOTES.md`.

**Status labels**

- **Confirmed:** every dump agrees with it, and so do the owner's labels.
- **Likely:** fits everything seen, but rests on only a few data points.
- **Open:** not known yet.

## Sources

| Dumps | Cards | Taken |
| --- | --- | --- |
| 1 daily card | 16 history entries over three weekdays, every tap labelled by the owner | 2026-10-23 |
| 2 souvenir KMTs | 2–3 history entries each, mostly from 2024 | 2026-10-23 |
| 6 daily-card dumps, one after each step of a morning commute | KRL tap-in (Cakung), KRL tap-out (Sudirman), LRT tap-in (Dukuh Atas), LRT tap-out (Rasuna Said), a TransJakarta tap-in with a GoPay top-up, then the TransJakarta tap-out | 2026-10-23 |
| 7 daily-card dumps on the evening commute | TransJakarta tap-in and tap-out; LRT Setiabudi to Dukuh Atas; KRL tap-in and tap-out at Sudirman without riding; MRT tap-in (Dukuh Atas) and tap-out (Bundaran HI) | 2026-10-23 |
| 1 more souvenir KMT, the one with only read-only codes | 5 history entries, one day of them pieced together by the owner: KRL Kranji to Jakarta Kota, a KCI top-up, MRT Bundaran HI to Dukuh Atas, KRL Sudirman to Kranji | 2026-10-24 |
| 1 daily-card dump after a KRL tap-in at Cakung | Purse unchanged by the tap-in | 2026-10-26 |
| 1 daily-card dump after two GoPay top-ups, 200,000 and 100,000 | The purse rose by exactly 300,000 | 2026-10-30 |

The dumps themselves aren't kept in the repo: they hold card numbers and travel history.

## System and services (confirmed)

**System:** a single system, `90B7`, with IC code `0146`. The card doesn't answer polls for
FeliCa Lite-S (`88B4`) or Secure ID (`957A`).

**Readable services:** every service listed here can be read without a key. Where two codes
are given, both show the same data. Both codes were present on three of the four cards; the
fourth (2026-10-24, a card that gave a read error on `1013`) lists only the second code of each
pair: `1017`, `200F` and `300B`. So a reader has to be able to use either. That card also lacks
`3089`, every `5xxx` service and area `5000`; of the trip data it has only `30CB`.

| Codes | Kind | Blocks | Contents |
| --- | --- | --- | --- |
| `1013`, `1017` | Purse (cashback/decrement; read-only) | 1 | Balance (see below) |
| `200D`, `200F` | Cyclic (read/write; read-only) | 16 | Ride history, newest first |
| `3009`, `300B` | Random (read/write; read-only) | 1 | The card number as 16 ASCII digits (**confirmed**: matches the number e-money apps show for the card) |
| `3089` | Random, read/write | 5 | The trip in progress, encrypted (see below) |
| `30CB` | Random, read-only | 2 | A copy of `3089` blocks 1–2 as they stood after the last KRL tap (see below) |
| `5009`/`500B`, `5049`/`504B`, `5089`/`508B`, `50CB`, `510B` | Random | 6 each | All zero on every card, a daily card included: unused |

**Keyed services:** these need a key and so aren't read. They are listed here only to show the
card's layout, and all have key version `D001`:

`1010`, `1012`, `200C`, `3008`, `3048`, `304A`, `3088`, `30C8`, `4008`, `5008`, `5048`, `5088`,
`50C8`, `5108`, `5148`, `51C8`

**Areas:** `0000`, `1000`, `1001`, `2000`, `2001`, `3000`, `3001`, `3081`, `4000`, `4001`,
`5000`.

## Balance: `1013` block 0 (confirmed)

The block is laid out exactly as the FeliCa purse block in UM §3.4.4:

| Bytes | Field | Notes |
| --- | --- | --- |
| D0–D3 | Balance, rupiah, little-endian | Matches the owner's own balance |
| D4–D7 | Last amount deducted, little-endian | Equals the newest ride's fare; zero after a top-up |
| D8–D13 | User data | Zero on every card |
| D14–D15 | Execution ID, big-endian | Goes up by one with each transaction |

## Ride history: `200D`, 16 blocks (confirmed unless marked)

**When an entry is written:** one entry per ride, at tap-out, and one per top-up. A tap-in writes
nothing here, on KRL, LRT and TransJakarta alike: TransJakarta also charges at tap-out. An
all-zero block is an empty slot.

| Bytes | Field | Status |
| --- | --- | --- |
| D0–D3 | Time, in seconds since 2000-01-01 00:00 UTC, big-endian | **Confirmed**: matches the owner's tap-out times to the minute, in WIB |
| D4–D7 | Amount, rupiah, big-endian | **Confirmed**: a 200,000 top-up reads `00 03 0D 40`, so D4–D5 are the high half |
| D8–D13 | What the ride was: see below | Varies |
| D14–D15 | The purse's execution ID after this entry | **Confirmed**: runs in step with the purse's |

### D8–D13 by mode

| Mode | D8–D13 | Seen |
| --- | --- | --- |
| KRL | `01 ss 01 xx 01 00` | Fares of 3,000; 1 for leaving at the station tapped in at. `xx` is `01` on all but one ride |
| LRT Jabodebek | `00 05 00 ss 01 01` | Fares of 5,000 and 5,700 |
| TransJakarta (JakLingko gates) | `01 16 00 1C 01 01` | 3,500, flat |
| MRT Jakarta (JakLingko gates) | `01 16 00 ss 01 01` | 0 (Dukuh Atas to Bundaran HI) and 3,000 (Bundaran HI to Dukuh Atas) |
| Top-up through GoPay | `00 55 00 01 00 01` | 50,000 |
| Top-up through KCI | `00 37 00 01 00 01` | 15,000 |
| First entry on a new card | `01 ss 02 01 00 00` | Starting balance of 10,000 |

**D12** is `01` on every ride, free ones included, and `00` on both top-ups and the starting
balance. So it is probably the direction: `01` money out, `00` money in (**likely**). The history
holds no balance, so this flag is the only way to tell a top-up from a fare. On the read-only
souvenir the whole history, top-up included, sums to the purse's balance with this sign.

**Top-ups.** Each top-up writes one entry. The owner added 300,000 through GoPay as two top-ups,
200,000 then 100,000, because GoPay allows at most 200,000 at a time. They are two entries, 36
seconds apart, each with its own execution ID, and the purse rose by their sum.

D8–D9 says where the money came from. `0055` is a top-up in GoPay. `0037` came at
the minute the owner's GoPay history shows a payment to "KCI", so it is a top-up bought in KCI's
own app and paid with GoPay (**likely**: one entry).

**A guess at the rest (likely).** On every entry that isn't KAI's own, D13 is `01`, and D8–D11
read naturally as two big-endian numbers:
- an operator or fare system: `0005` LRT Jabodebek, `0116` JakLingko (both TransJakarta and MRT),
  `0055` GoPay, `0037` KCI's top-up
- a place or operator within it: the LRT station, `001C` TransJakarta, the MRT station, `0001` on
  both top-ups

TransJakarta and MRT sharing `0116` but differing in D10–D11 is what moved this from a guess to
likely. KAI's own entries (KRL rides and the sale) have D13 = `00`, a station in D9, and D10 =
`01` on a ride, `02` on a sale.

**KRL.** `ss` is the tap-out station (**confirmed**). Tapping in and out at Sudirman, without
riding, gave `48`, so `48` is Sudirman. Rides from Cakung to Sudirman also give `48`, so the code
is the station tapped out at. `26` then comes from the rides from Sudirman to Kranji. `24` is a
ride from Kranji, tapped out at 14:27, two minutes before the owner's video from the Museum
Sejarah Jakarta beside Jakarta Kota.

| Code | Station |
| --- | --- |
| `24` | Jakarta Kota |
| `26` | Kranji |
| `48` | Sudirman |

Two souvenir cards bought at Sudirman have `48` in their first entry, and one bought at Kranji
has `26`: on a sale, `ss` is where the card was sold.

**D11 on KRL** is `01` on every ride but one: a Sudirman to Kranji ride on 2026-10-23, out at
21:33, has `64`. The owner's location history confirms the route, and the fare (3,000) and every
other byte match the usual Sudirman to Kranji ride. What `64` means is **open**. That evening the
card had earlier been tapped in and out at Sudirman without riding (1 rupiah, 20:22) and had paid
for TransJakarta, LRT and MRT. But on 2026-10-28 the same 1-rupiah exit at Sudirman came before a
Kranji ride with `01`, so that alone doesn't explain it. A reader should accept any D11 on a KRL
entry.

**Leaving at the station tapped in at** cost 1 rupiah. It's an ordinary KRL entry, with
D12 = `01`.

**LRT Jabodebek.** `ss` is the tap-out station (**confirmed**). The same pair of stations was
ridden in both directions: Rasuna Said to Dukuh Atas gave `01`, and Dukuh Atas to Rasuna Said
gave `03`.

| Code | Station |
| --- | --- |
| `01` | Dukuh Atas |
| `02` | Setiabudi |
| `03` | Rasuna Said |

These are neighbouring stations, numbered in line order from the Dukuh Atas end.

**TransJakarta.** The bytes are identical at different tap-in and tap-out haltes, so these
entries carry no halte (**confirmed**). All eight rides seen were on Koridor 6, and KAI's own app
sometimes labels these entries "TRANSJAKARTA KORIDOR 6". So `001C` could still be the corridor
rather than TransJakarta as a whole (**open**). A ride on another corridor would tell. Since MRT
puts its station in D10–D11, `001C` could also be a halte code that every halte so far shared,
but the rides seen tapped out at more than one halte, so that seems unlikely.

A TransJakarta ride paid with another card leaves no trace on this one: the read-only souvenir's
owner rode Kota to Bundaran HI between its KRL and MRT entries on a JakLingko card.

TransJakarta doesn't take KMT itself. Its gates run JakLingko's software, accept KMT as an
integrated transport card, and show "JAKLINGKO Rp3500" on a tap. Label these entries
"TransJakarta" when D10–D11 = `001C`, and "JakLingko" for an unknown `0116` entry.

**MRT Jakarta.** D10–D11 is the tap-out station (**confirmed**). Dukuh Atas to Bundaran HI gave
`0010`, and Bundaran HI to Dukuh Atas, on another card, gave `000F`; the owner has a video of
that tap-out at Dukuh Atas at the same minute.

| Code | Station |
| --- | --- |
| `000F` | Dukuh Atas |
| `0010` | Bundaran HI |

These are neighbouring stations, numbered upward towards the Bundaran HI end. A code not in the
table can't be told from another JakLingko operator, so it stays unread.

Why the first ride was free is **open**. It began 21 minutes after a TransJakarta fare on the same
card, so JakLingko's integrated fare is one possibility. The second ride cost 3,000 and followed
no JakLingko fare on its card (the TransJakarta leg before it was on another card), which fits.

Other readers show these entries as Tebet. We don't, because:
- It doesn't fit what the gate shows.
- It isn't something our own dumps tell us.

**First entry on a new card.** D10 is `02` only on a card's first entry, the starting balance.
It marks the sale, not top-ups in general: the GoPay top-up has D10 = `00` (**likely**).

## The trip in progress: `3089` and `30CB` (confirmed unless marked)

Tapping in writes nothing readable: the purse and history are unchanged. Every tap, in and out,
rewrites one or two blocks of `3089` instead. The blocks look like ciphertext, so the station
tapped in at can't be read without a key. A reader can't show "you tapped in at Cakung".

Each 16-byte block looks encrypted on its own, with no key that differs per card. The same
ciphertext turns up in different blocks and on two different cards, and a block can stay the
same while its neighbour changes. Call that recurring value **G**.

| Block | What changed it |
| --- | --- |
| 0 | Nothing seen |
| 1 | Every tap-in, KRL and LRT: probably the tap-in record |
| 2 | Every tap: G after a KRL or LRT tap-in, something different after each tap-out |
| 3 | Nothing seen on the daily card. G on a souvenir card whose last ride was TransJakarta |
| 4 | Every TransJakarta and MRT tap, in and out, to a new value each time: JakLingko's own trip record (**likely**). The top-up seems to write nothing here |

Blocks 3–4 are all zero on the one card that has never been to TransJakarta or topped up.

Block 2 was G after all three rail tap-ins seen (KRL at Cakung, LRT at Dukuh Atas and at
Setiabudi), and never after a tap-out. So block 2 = G probably means "tapped in on rail, not out
yet", which a reader could show. That rests on a ciphertext constant, so treat it as **likely** at
best. TransJakarta has nothing like it: block 4 is different after every tap, so a reader can't
tell whether a TransJakarta trip is in progress.

`30CB` holds the same two blocks as `3089` blocks 1–2, but changes only on KRL taps. After an
LRT ride it still holds the values from the KRL ride before. KAI seems to keep its own copy.

## What the app reads (`reader/KmtReader.kt`)

On a tap on home or the card page the app reads `1017` block 0, `300B` block 0 and `200F` blocks
0-15, and nothing else: two Read Without Encryption commands of up to 12 blocks, each across all three
services. It sends no poll first, since Android has already found the card by system `90B7`. Every
card seen lists those read-only codes; a card that refuses them is read the same way through
`1013`, `3009` and `200D` instead. Each field it shows rests on a section above:

- Balance: D0-D3 of the purse, little-endian (confirmed).
- Time, amount and entry kind: D0-D3, D4-D7 and D8-D13 of each non-empty history block (confirmed).
- Money in or out: D12 (likely). If a top-up or a refund turns out to read the wrong way, the sign
  in `KmtReader.entry` is the one line to change.
- Station names: only the KRL, LRT and MRT tap-out codes listed above, MRT under the names the
  app's station data uses. Any other KRL or LRT code leaves the place blank, and the app then
  shows the operator's name instead.
- Only the last four digits of the card number reach the screen.

## Open questions and the dumps that would answer them

- **MRT: why was the first ride free?** A ride not long after a JakLingko fare on the same card,
  and another well after one, would show whether integration is the reason.
- **More MRT stations:** each new tap-out station gives one more code.
- **TransJakarta: is `001C` Koridor 6?** Dump after a ride on another corridor.
- **More stations:** each new KRL or LRT tap-out station gives one more code.
- **KRL D11 = `64`:** another KRL entry that isn't `01`, with the owner's notes on that day, may
  show what sets it.
