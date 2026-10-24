# Mandiri e-Money (JakLingko card): what a tap shows

Worked out from one card, the owner's Mandiri e-Money with JakLingko's card design, which is used
for transit and shops. There were two scans on 2026-10-25: the card dumper (format 2) and NXP's
TagInfo 6.3.0. Only what the card itself answered is written here. The card's ID and serial
numbers are left out.

**Conclusion: nothing on this card can be read without keys or IDs we don't have.** There's no
reader for it, and none is planned.

## The chip

| Fact | Value | From |
| --- | --- | --- |
| Interface | ISO 14443-4 type A (ISO-DEP), plus MIFARE Classic emulation | Android tech list: `IsoDep`, `NfcA`, `MifareClassic` |
| ATQA, SAK | `0400`, `28` | Dumper, TagInfo |
| Historical bytes | `4A434F50424D4232`, ASCII `JCOPBMB2` | Dumper, TagInfo |
| IC | NXP SmartMX2, made 2022-10-21 | TagInfo, from the card's CPLC data |
| Card OS | Java Card 2.3, GlobalPlatform 2.2, secure channel SCP02 option 55 | TagInfo |
| MIFARE Classic side | 2 KB: 32 sectors of 4 blocks | TagInfo |

## The smart-card side (ISO-DEP)

- **No PSE.** SELECT of `1PAY.SYS.DDF01` answers `6A82` (dumper). So EMV Book 1 offers no way to
  list the applications: SELECT by name needs at least the 5-byte RID (B1 Table 5).
- **The default selection is the GlobalPlatform card manager**, AID `A000000151000000`, with FCI
  `6F108408A000000151000000A5049F6501FF` (TagInfo).
- **No other application was found.** TagInfo reports neither the e-Money nor a JakLingko applet.
- Listing the applets through the card manager needs a secure-channel login. A failed login can
  lock a GlobalPlatform card, so the dumper never tries.

## The MIFARE Classic side

- 30 of the 32 sectors refuse every key TagInfo tried. There's no MIFARE Application Directory.
- Sectors 29 and 30 (blocks 116–123) open with the factory key `FFFFFFFFFFFF`. Their data blocks
  are all zero, and their trailers carry access bits `7F 07 88`: unused.

## What would change this

- **An applet ID and its commands seen on our own card**, for example a sniffer such as a Proxmark
  recording the card with Mandiri's app or at a gate. That would be our own observation, as the
  KMT dumps are.
- **A spec published by Mandiri or JakLingko.** None is known.

Neither the commands other apps use for these cards nor their keys may be used: see `README.md`.
