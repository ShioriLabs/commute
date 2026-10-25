# Mandiri e-Money: what a tap shows

Worked out from two of the owner's cards, both scanned on 2026-10-25 with the card dumper
(format 2) and NXP's TagInfo 6.3.0:

- **Card A**: a Mandiri e-Money with JakLingko's card design, used for transit and shops.
- **Card B**: a plain Mandiri e-Money, without the JakLingko design.

Only what the cards themselves answered is written here. Their IDs and serial numbers are left
out. Where the two cards differ, the table and lists below say so. Otherwise they answered the
same.

**Conclusion: nothing on either card can be read without keys or IDs we don't have.** There's no
reader for them, and none is planned.

## The chip

| Fact | Value | From |
| --- | --- | --- |
| Interface | ISO 14443-4 type A (ISO-DEP), plus MIFARE Classic emulation | Android tech list: `IsoDep`, `NfcA`, `MifareClassic` |
| ATQA, SAK | `0400`, `28` | Dumper, TagInfo |
| Historical bytes | `4A434F50424D4232`, ASCII `JCOPBMB2` | Dumper, TagInfo |
| IC | NXP SmartMX2. Card A was made 2022-10-21, card B 2020-06-19 | TagInfo, from each card's CPLC data |
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

### Through a PC/SC reader (card B)

Card B was also probed on an ACR122 through Windows' `winscard.dll`, using only commands that
need no login. ATR: `3B8880014A434F50424D423260`.

| Command | Answer |
| --- | --- |
| SELECT `1PAY.SYS.DDF01` (PSE) | `6A82` |
| SELECT `2PAY.SYS.DDF01` (PPSE, the contactless directory) | `6A82` |
| SELECT with an empty AID | the card manager's FCI, as above |
| GET DATA `9F7F` (CPLC) | the same as TagInfo's |
| GET DATA `0066` (card recognition data) | GlobalPlatform 2.2, SCP02 option 55, and a Java Card OID under Sun's arc (`1.3.6.1.4.1.42.2.110.1.3`) |
| GET DATA `00E0` (key information) | 3 keys, IDs 1–3, all key version `01`, each a 16-byte DES key: the usual SCP02 ENC/MAC/DEK set |
| GET DATA `0042`, `0045` (issuer ID, card image number) | `6A88`, not present |

So a contactless payment directory doesn't exist either, and the card manager says only what
TagInfo already showed. A reader on a PC sees what the phone sees. It can't record what a gate or
Mandiri's app sends, so it adds no way in.

## The MIFARE Classic side

- Most sectors refuse every key TagInfo tried: 30 of 32 on card A, 29 of 32 on card B. Neither
  card has a MIFARE Application Directory.
- On both cards, sectors 29 and 30 (blocks 116–123) open with the factory key `FFFFFFFFFFFF`. Card
  B also opens sector 14 (blocks 56–59) that way. In every open sector the data blocks are all
  zero and the trailer carries access bits `7F 07 88`: unused.

## What would change this

- **An applet ID and its commands seen on our own card**, for example a sniffer such as a Proxmark
  recording the card with Mandiri's app or at a gate. That would be our own observation, as the
  KMT dumps are.
- **A spec published by Mandiri or JakLingko.** None is known.
- **A bank's partner SDK**, used under its own agreement. That is probably how the other apps that
  read these cards do it, unless they reverse-engineered a bank's app.

Neither the commands other apps use for these cards nor their keys may be used, and nothing may be
reverse-engineered from a bank's app (Livin', BNI Mobile, BCA mobile and the like): see `README.md`.
