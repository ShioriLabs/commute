# Card sources

Everything the card dumper knows about FeliCa and smart cards comes from the documents below
and from the Android references. Nothing comes from other readers' source code. The PDFs are kept
here locally and are gitignored. Download your own copies from Sony.

| Document | Version | Date | Where |
| --- | --- | --- | --- |
| FeliCa Card User's Manual Excerpted Edition | 2.31 | 2026-05-28 | https://www.sony.co.jp/en/Products/felica/business/tech-support/ |
| FeliCa Technology Code Descriptions (M619) | 1.7 | 2026-03-31 | same page |
| FeliCa Card Technical Note for Software Development (M606) | 2.6 | 2026-03 | same page |
| Development Guidelines for NFC/FeliCa-Enabled Devices and Applications (M830) | 1.5 | 2023-10 | same page |
| Format Distinction Sequence Design Guidelines (M621) | 1.3 | — | same page |
| FeliCa Card Command Sequence Design Guidelines | 1.2 | 2025-01-28 | same page |
| Android `NfcF` reference | — | — | https://developer.android.com/reference/android/nfc/tech/NfcF |
| EMV Book 1: Application Independent ICC to Terminal Interface Requirements | 4.4 | 2022-10 | https://www.emvco.com/specifications/ (free, after accepting EMVCo's terms) |
| Android `IsoDep`, `NfcA`, `NfcB` references | — | — | https://developer.android.com/reference/android/nfc/tech/IsoDep |

`NOTES.md` lists every constant the code uses, written in our own words, each with the section
it came from. A fact that isn't in these documents doesn't go in the code.

Card-specific facts (which services a KMT card holds, what its blocks mean) never come from
these documents. They come from dumps of our own cards and are written up in `KMT.md` and
`EMONEY.md`. The app's readers are for FeliCa cards; the dumper's NFC-A and NFC-B support is for
looking at other cards, not for reading them.
