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

The dumps themselves aren't kept in the repo: they hold card numbers and travel history.

## System and services (confirmed)

**System:** a single system, `90B7`, with IC code `0146`. The card doesn't answer polls for
FeliCa Lite-S (`88B4`) or Secure ID (`957A`).

**Readable services:** every service listed here can be read without a key. Where two codes
are given, both show the same data, and both codes were present on all three cards.

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
| D4–D5 | Always zero | **Open**: may be the high half of a 4-byte amount. A top-up of 50,000 still fits in D6–D7, so it takes one over 65,535 to tell |
| D6–D7 | Amount, rupiah, big-endian | **Confirmed** |
| D8–D13 | What the ride was: see below | Varies |
| D14–D15 | The purse's execution ID after this entry | **Confirmed**: runs in step with the purse's |

### D8–D13 by mode

| Mode | D8–D13 | Seen |
| --- | --- | --- |
| KRL | `01 ss 01 01 01 00` | Fares of 3,000; 1 for leaving at the station tapped in at |
| LRT Jabodebek | `00 05 00 ss 01 01` | Fares of 5,000 and 5,700 |
| TransJakarta (JakLingko gates) | `01 16 00 1C 01 01` | 3,500, flat |
| MRT Jakarta (JakLingko gates) | `01 16 00 10 01 01` | 0, once: Dukuh Atas to Bundaran HI |
| Top-up through GoPay | `00 55 00 01 00 01` | 50,000 |
| First entry on a new card | `01 ss 02 01 00 00` | Starting balance of 10,000 |

**D12** is `01` on every ride, free ones included, and `00` on the top-up and the starting
balance. So it is probably the direction: `01` money out, `00` money in (**likely**). The history
holds no balance, so this flag is the only way to tell a top-up from a fare.

**A guess at the rest (likely).** On every entry that isn't KAI's own, D13 is `01`, and D8–D11
read naturally as two big-endian numbers:
- an operator or fare system: `0005` LRT Jabodebek, `0116` JakLingko (both TransJakarta and MRT),
  `0055` GoPay
- a place or operator within it: the LRT station, `001C` TransJakarta, `0010` MRT, `0001` GoPay

TransJakarta and MRT sharing `0116` but differing in D10–D11 is what moved this from a guess to
likely. KAI's own entries (KRL rides and the sale) have D13 = `00`, a station in D9, and D10 =
`01` on a ride, `02` on a sale.

**KRL.** `ss` is the tap-out station (**confirmed**). Tapping in and out at Sudirman, without
riding, gave `48`, so `48` is Sudirman. Rides from Cakung to Sudirman also give `48`, so the code
is the station tapped out at. `26` then comes from the rides from Sudirman to Kranji.

| Code | Station |
| --- | --- |
| `26` | Kranji |
| `48` | Sudirman |

The souvenir cards' first entries, both bought at Sudirman, carry `48` too: on a sale, `ss` is
where the card was sold.

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
rather than TransJakarta as a whole (**open**). A ride on another corridor would tell.

TransJakarta doesn't take KMT itself. Its gates run JakLingko's software, accept KMT as an
integrated transport card, and show "JAKLINGKO Rp3500" on a tap. Label these entries
"TransJakarta" when D10–D11 = `001C`, and "JakLingko" for an unknown `0116` entry.

**MRT Jakarta.** One ride, Dukuh Atas to Bundaran HI, gave `0010` in D10–D11 and an amount of 0.
It isn't known yet whether `0010` means MRT as a whole or Bundaran HI (**open**). Why it was free
is also **open**: the ride began 21 minutes after a TransJakarta fare, so JakLingko's integrated
fare is one possibility.

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

On a tap on home the app polls system `90B7`, then reads `1013` block 0, `200D` blocks 0-15 and
`3009` block 0, and nothing else. Each field it shows rests on a section above:

- Balance: D0-D3 of the purse, little-endian (confirmed).
- Time, amount and entry kind: D0-D3, D6-D7 and D8-D13 of each non-empty history block (confirmed).
- Money in or out: D12 (likely). If a top-up or a refund turns out to read the wrong way, the sign
  in `KmtReader.entry` is the one line to change.
- Station names: only the tap-out codes listed under the history table. Any other code leaves the
  place blank, and the app then shows the operator's name instead.
- Only the last four digits of the card number reach the screen.

## Open questions and the dumps that would answer them

- **The amount field:** a top-up over 65,535 shows whether D4–D5 are part of it.
- **MRT: is `0010` the line or the station?** Dump after an MRT ride that ends somewhere other
  than Bundaran HI. A paid MRT ride, not long after any JakLingko fare, would also show whether
  integration is why the first one was free.
- **TransJakarta: is `001C` Koridor 6?** Dump after a ride on another corridor.
- **More stations:** each new KRL or LRT tap-out station gives one more code.
