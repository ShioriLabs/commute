# Japanese IC cards

The app reads a Japanese transit IC card the way it reads a KMT: balance in yen on the card's face,
and a history. The page also shows a joke, since the card is no use in Jakarta. Its entries don't
name an operator or a station. Money in shows as "Top Up" and money out as "Pembayaran".

This file is the source for every fact the reader uses. They all come from one dump of our own
PASMO, taken with the debug dumper on 2026-10-23 (note "PASMO beneran", S23). No other reader's
code was consulted.

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

The reader doesn't use the stations, so every entry is shown as money in or money out.

Slot 2, with D0 `08` where the rides have `16` and `17`, is the card being issued with ¥500 on it.
The reader shows a slot with D0 `08` as "Pembelian Kartu". This rests on one card.

Nothing in the dump names an operator. D0–3 is identical across the two rides. The line byte of
the station codes (`2D`) is the nearest candidate, but that's a guess. Finding the operator would
take a dump with a non-JR ride on it.

The gate-tap service `108F` holds what looks like the time of each tap: hh and mm as plain decimal
at D8–9 (`1502` and `1514` for Iwafune in and Tochigi out). It also holds the fare at D10–11,
little-endian (`C7 00` = ¥199, `F2 00` = ¥242). The reader doesn't use either.

**Assumptions, unverified:**
- A history with free slots starts from an empty card. So its oldest entry counts from ¥0, and the
  issue reads as a ¥500 top-up.
- In a full history, the oldest entry has nothing to count from, so the reader leaves it out.
- The other mutual-use cards (Suica, ICOCA and the rest) share PASMO's layout, since only PASMO has
  been dumped. If one doesn't, its figures come out wrong, which is harmless for a joke.

The card's other services (gate taps, stations) aren't used and aren't written up here. Retail
e-money cards (nanaco, WAON, Edy) use a different system, and get the ordinary "can't read this
card" message.
