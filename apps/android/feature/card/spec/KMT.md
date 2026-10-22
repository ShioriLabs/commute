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
| `3089` | Random, read/write | 5 | Looks random; blocks 3–4 are zero on one card (**open**) |
| `30CB` | Random, read-only | 2 | The same data as `3089` blocks 1–2 (**open**) |
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
| D4–D7 | Last amount deducted, little-endian | Equals the newest history entry's amount |
| D8–D13 | User data | Zero on every card |
| D14–D15 | Execution ID, big-endian | Goes up by one with each transaction |

## Ride history: `200D`, 16 blocks (confirmed unless marked)

**When an entry is written:** one entry per ride, at tap-out. A tap-in writes nothing here. An
all-zero block is an empty slot.

| Bytes | Field | Status |
| --- | --- | --- |
| D0–D3 | Time, in seconds since 2000-01-01 00:00 UTC, big-endian | **Confirmed**: matches the owner's tap-out times to the minute, in WIB |
| D4–D5 | Always zero | **Open**: may be the high half of a 4-byte amount |
| D6–D7 | Amount, rupiah, big-endian | **Confirmed** |
| D8–D13 | What the ride was: see below | Varies |
| D14–D15 | The purse's execution ID after this entry | **Confirmed**: runs in step with the purse's |

### D8–D13 by mode

| Mode | D8–D13 | Seen |
| --- | --- | --- |
| KRL | `01 ss 01 01 01 00` | Fares of 3,000 |
| LRT Jabodebek | `00 05 00 ss 01 01` | Fares of 5,000 and 5,700 |
| TransJakarta (JakLingko gates) | `01 16 00 1C 01 01` | 3,500, flat |
| First entry on a new card | `01 ss 02 01 00 00` | Starting balance of 10,000 |

**KRL.** `ss` is a station code (**likely**). It's still **open** whether it's the station tapped
in at or the one tapped out at:

| Code | If it's the tap-out station | If it's the tap-in station |
| --- | --- | --- |
| `48` | Sudirman | Cakung |
| `26` | Kranji | Sudirman |

The owner believes both souvenir cards were bought at Sudirman, and both cards' first entries
carry `48`. That leans towards the tap-out reading, but it isn't confirmed.

**LRT Jabodebek.** `ss` is the tap-out station (**likely**):

| Code | Station |
| --- | --- |
| `01` | Dukuh Atas |
| `02` | Setiabudi |

These are neighbouring stations, numbered in line order from the Dukuh Atas end.

**TransJakarta.** The bytes are identical at different tap-in and tap-out haltes, so these
entries carry no halte (**confirmed**). Label them "JakLingko": TransJakarta doesn't take KMT
itself, but its gates run JakLingko's software, accept KMT as an integrated transport card, and
show "JAKLINGKO Rp3500" on a tap.

Other readers show these entries as Tebet. We don't, because:
- It doesn't fit what the gate shows.
- It isn't something our own dumps tell us.

**D12–D13.** These read `01 00` on KRL entries and `01 01` on the rest (**open**).

**First entry on a new card.** D10 is `02` only on a card's first entry, the starting balance,
so it may mark a sale or top-up (**likely**). No top-up has been seen yet.

## Open questions and the dumps that would answer them

- **KRL: tap-in or tap-out station?** Dump after any KRL ride that doesn't start or end where
  the usual ones do.
- **Where is the tap-in kept?** KRL fares depend on distance, so the card must hold the station
  tapped in at. Dump just after a tap-in, before tapping out, and diff it against the dump
  before. My guess is `3089`, or a keyed service.
- **Top-ups:** dump before and after one, to confirm D10 = `02` and see what D8–D9 hold.
- **Rides by MRT Jakarta**, if KMT works there: what its entries look like.
- **More KRL stations:** each new tap-out or tap-in station gives one more code.
