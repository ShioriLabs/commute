# Android: IC card balance

**Status:** design note, not yet implemented. Part of `android-app.md`.

## Goal

Tap a card on the phone, see its balance, and have every fare result answer the
question riders actually have at the gate:

> **Saldo kamu Rp 8.500. Perjalanan ini Rp 13.000, kurang Rp 4.500.**

A balance checker on its own is a commodity. What Commute adds is the
comparison: it already knows what the trip costs, per operator, so it can say
whether *this card* covers *this trip* before the rider is stuck at a gate.

## Scope: KMT first, and only KMT

Launch covers **KMT**, KAI Commuter's Kartu Multi Trip, and nothing else.

- It's the commuter card: the one most tied to the fares this app computes.
- One card means one read path to get right, test against real cards, and
  support.
- Every further card is its own decision (see "Later cards"), not a backlog
  item that ships by default.

## What the rider sees

- **Card screen:** "Tempel kartu di belakang HP". On a successful read: the
  balance, the card type, and when it was read. Reading only happens while this
  screen (or the prompt below) is open.
- **On a fare or trip result:** if a balance was read recently, a line under
  the fare: "Saldo cukup" or "Kurang Rp X". If not, a quiet "Cek saldo" action
  that opens the tap prompt and returns to the result.
- **Saved cards (optional):** a rider can keep a card's last balance with a
  nickname. The balance is labelled with its age; it is a reading, not a live
  value.

### "Enough for this trip?" is per operator

A journey can cross operators, and a card is only accepted by some of them. The
comparison uses the journey's **`segments[]`** (the billing view of a journey),
not `totalFare`:

1. Take the segments whose operator accepts the card.
2. Compare their fares with the balance, in travel order.
3. Say which part the card covers and which it doesn't: "Cukup buat KRL
   (Rp 5.000). LRT-nya bayar pakai yang lain ya."

That needs a small **card acceptance table** (card → operators that accept it),
curated in `@commute/constants` next to the tariff constants. Operators also
enforce a minimum balance at entry; that rule belongs in the same table, with
its source noted, once verified.

## Reader design

```kotlin
interface CardReader {
    val cardType: CardType

    /** Null when the tapped tag isn't this card type: the auto-detect signal, not an error. */
    fun tryRead(tag: Tag): CardBalance?
}

data class CardBalance(val cardType: CardType, val balanceRupiah: Long, val readAt: Instant)
```

- **One reader per card type.** Card types differ in NFC technology and command
  sequence, so each gets its own implementation. `tryRead` takes the raw `Tag`
  and picks the technology it needs: **KMT is a FeliCa card**, read through
  Android's `NfcF`, while the bank-issued cards that may come later are
  ISO-DEP. An interface typed to one technology would have to be redone for the
  second card.
- **Auto-detect by trying readers in turn.** A reader returns `null` for a card
  that isn't its own and throws only on a real I/O failure. Adding a card later
  means adding a reader; the screens don't change.
- **Reader mode, screen-scoped.** NFC reader mode is enabled only while the card
  screen or the tap prompt is visible, so the app never grabs taps meant for
  payment apps.
- **Read-only, always.** The app sends read commands and nothing else. No
  writes, no top-up, no emulation.

`:feature:card:api` holds this interface and `CardBalance`, with no dependency
on the rest of the app, so a reader can be tested against recorded card
responses without a device.

### Where the readers live

The interface above, the screens and the fare comparison are in this public
repo. **Reader implementations are not**: each one lives in a separate private
repo and is included only in release builds (`android-app.md`, "Where the code
lives").

- The public build registers no readers and hides the card screen, so the app
  builds and runs for anyone without the private repo.
- Readers register themselves through a small provider the app looks up at
  start; a build without the private module simply finds none.
- Recorded card responses used as test fixtures live with the readers, in the
  private repo. The public repo tests the screens and the comparison against a
  fake reader.

## Before it ships: the verification gate

The read sequence for a card is only trusted after it has been checked against
**real cards with known balances**:

- several physical cards, including a new one, an old one and one near zero;
- balance compared against the operator's own reading (a gate, a vending
  machine or the official app);
- a read after a top-up and after a ride, to confirm it tracks changes;
- behaviour with the wrong card types, torn taps and phone cases.

A wrong balance is worse than no balance: the rider gets stopped at the gate
*because* they trusted the app. Until the gate passes on real cards, the feature
stays behind a flag.

Command sequences are implementation detail. They live with the reader code and
its tests in the private repo, never in this note or anywhere in this repo.

## Privacy

- The balance and any card identifier **stay on the device**. Nothing about a
  card is ever sent to the API or anywhere else.
- A card number is kept only if the rider saves the card, and then only to tell
  saved cards apart. It's shown masked.
- "Hapus data" in settings removes saved cards along with everything else.

## Risk notes

- **Reading a balance the card exposes** to any reader is the whole feature.
  The app does not defeat card security to get it.
- **Cards that require issuer keys** to authenticate before a read are a
  different category: shipping someone else's keys is a legal risk this app
  doesn't take by default. They stay out unless there's an explicit decision
  to include one.
- No operator or issuer logos on the card screen; cards are named in text.
- Each reader is self-contained and lives outside this repo, so if an operator
  or issuer objects to a card being read, that one reader can be removed in a
  single release. The public repo, and everything else Commute ships from it,
  is never part of that dispute.

## Later cards

Each is a separate follow-up with its own verification gate: the bank-issued
e-money cards riders use on TransJakarta, MRT and LRT would widen "enough for
this trip?" to the rest of a journey, which is where it becomes most useful.
Order them by how many riders carry them and by whether their balance can be
read without issuer keys.

## Build order

1. `CardReader`, `CardBalance` and the reader provider here, with a fake reader
   for tests. The private repo, with the KMT reader and its tests against
   recorded responses.
2. Card screen with reader mode and the tap prompt.
3. Verification gate on real cards.
4. Card acceptance table in `@commute/constants`; the per-operator comparison
   on fare and trip results.
5. Saved cards.

## Open questions

- Transaction history (last rides and top-ups): useful, but more data to read
  and more to get wrong. Lean: not in v1.
- How long a reading counts as "recent" for the result line (lean: until the
  next ride would have changed it, so a few hours).
- Whether the comparison should warn *before* the trip starts in trip mode
  ("saldo kurang buat turun di tujuan").
