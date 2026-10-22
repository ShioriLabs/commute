# FeliCa facts the dumper relies on

Each fact is written in our own words and points at its source. Abbreviations:

- **TN**: FeliCa Card Technical Note for Software Development v2.6 (M606-E02-60)
- **CD**: FeliCa Technology Code Descriptions v1.7 (M619-E01-70)
- **NFC**: Development Guidelines for NFC/FeliCa-Enabled Devices and Applications v1.5 (M830-E01-50)
- **FD**: Format Distinction Sequence Design Guidelines v1.3 (M621)
- **CS**: FeliCa Card Command Sequence Design Guidelines v1.2
- **UM**: FeliCa Card User's Manual Excerpted Edition v2.31

Multi-byte values are big-endian unless a fact below says little-endian (UM §1.2).

## Identity: IDm and PMm (CD §1–2)
- The Polling response carries IDm (8 bytes) right after its response code, then PMm (8 bytes).
- **IDm** is a 2-byte Manufacturer Code followed by a 6-byte Card Identification Number.
  - On a card with more than one System, each System has its own IDm. The top 4 bits of IDm's first byte give the System's number on the card.
  - A Manufacturer Code of `01FE`/`02FE`/`03FE` means NFC-DEP, Type 3 Tag, or Plug/Lite-S (CD Table 1-1).
- **PMm** is a 2-byte IC Code (ROM type, IC type) followed by 6 bytes of maximum-response-time parameters (CD §2.1). The formula that turns these into times is below.
- IDm isn't guaranteed to be unique, and on some devices it changes between taps (NFC §2.2). **A dump records it, but nothing should key on it.**

## Systems (CD §3, TN §2.3.1, NFC §2.7)
- The System Code is 2 bytes.
- **Shared codes:**
  - `12FC` NDEF
  - `4000`–`4FFF` HCE-F
  - `88B4` FeliCa Lite-S
  - `957A` FeliCa Secure ID
  - `AA00`–`AAFE` JIS X 6319-4
  - `FE00` Common Area
  - `FEE1` FeliCa Plug
- Every other code is assigned by Sony to a service provider.
- **Polling wildcard:** Polling accepts `FF` per byte as a wildcard. With `FFFF`, only System 0 answers, so the other Systems have to be found with Request System Code (TN §2.3.1).
- **Lite-S and Secure ID systems** don't show up in Request System Code, so to find them, Poll their codes directly (TN §2.1 item 10).
- **Switching Systems:** to talk to another System, Poll its System Code first, even if its IDm is already known. Commands go only to the System that answered the last Poll (NFC §2.7.1, TN §2.5).

## Polling parameters (TN §2.3.2–2.3.3, NFC §2.1.1)
- **Request Code** asks the card to append 2 bytes to its response:
  - `00` asks for nothing.
  - `01` asks for the System Code.
  - `02` asks for its communication speeds.

  A card may append nothing even when asked, so the parser has to allow for both.
- **Time Slot** takes only `00`, `01`, `03`, `07` or `0F`.
- For a card whose System Code isn't known, poll `FFFF` with Request Code `01`.

## Finding services (TN §2.4.1, §7.1; FD §1.4; CS §1)
- To check whether a Service or Area exists, send Request Service. A Key Version of `FFFF` in the response means "doesn't exist".
- **Caveat:** a node whose key version really is `FFFF` can't be found this way (TN §7.1). So the brute-force search can miss services, and the dump has to say so.
- Request Service takes up to 32 nodes per command (NFC §2.6, worst case at 32 nodes).
- Every FeliCa Standard card supports Search Service Code (TN Table 2-1), but UM doesn't publish its packet format. See below.

## Reading (TN §2.1 items 4 and 6, §2.4.1–2.4.3)
- Read Without Encryption reads Services that no key protects.
- It reads **up to 12 blocks per command** on every FeliCa Standard product. Use 12; the 15 that T3T allows isn't universal.
- Its Service Code List should list only Services that exist and that the Block List refers to.
- **Block List elements:** 2-byte and 3-byte forms can be mixed, and parsers must accept both. The layout is below.
- Use 2-byte Area and Service Codes: every product supports them, and 4-byte codes aren't universal.

## Status flags (TN §6)
- Status Flag 1 = Status Flag 2 = `00` means success.
- Status Flag 2 values `00`–`7F` mean the same thing on every product; `80`–`FF` are product-specific and only useful for debugging.
- Status Flag 1 is either `00` or `FF`.
- The values are listed in full below.

## Framing and timing on Android (NFC §2.6, §3.2–3.3; TN §2.6–2.7, §3.2; Android `NfcF` docs)
- **Framing:** `NfcF.transceive` takes `LEN | CMD | …` and the framework adds the preamble, sync code and CRC. LEN counts itself (TN Fig 3-5).
- **Reader mode:** `enableReaderMode` with `FLAG_READER_NFC_F | FLAG_READER_SKIP_NDEF_CHECK` keeps the phone on NFC-F and skips the NDEF read (NFC §3.2.1).
- **Presence checks:** Android polls `FFFF` to check the card is still there whenever no command has gone out for about 125 ms. That's harmless for unencrypted reads, but `EXTRA_READER_PRESENCE_CHECK_DELAY` can lengthen the interval (NFC §3.3).
- **Timeouts:** a command's worst-case response time can be up to about 5.1 s, for Request Service with 32 nodes. Allow timeouts that long, or work them out from PMm (NFC §2.6, TN §2.6).
- **One command at a time:** the card ignores a new command while it's still working on the last one. Wait for the response or the timeout before sending again (TN §2.7).

## Command and response codes (UM §2.3.3, Table 2-3)
A response code is always the command code + 1.

| Command | Command code | Response code |
| --- | --- | --- |
| Polling | `00` | `01` |
| Request Service | `02` | `03` |
| Request Response | `04` | `05` |
| Read Without Encryption | `06` | `07` |
| Search Service Code | `0A` | `0B` |
| Request System Code | `0C` | `0D` |

**Search Service Code can't be used.** UM §4.4.7 gives no packet format; it defers the details to a document disclosed only under a separate agreement. So **services are found by brute force with Request Service.**

## Packet layouts (UM §4.4.2–4.4.8)
In the tables, "`LEN`" is our framing byte (TN Fig 3-5). The rest is the UM packet.

**Polling (§4.4.2)**
- Command: `00 | system code (2) | request code (1) | time slot (1)`
- Response: `01 | IDm (8) | PMm (8) | [request data (2)]`
- The request data is present only when it was asked for and the card supports it.

**Request Service (§4.4.3)**
- Command: `02 | IDm (8) | n (1) | n node codes (2 each, little-endian)`, with 1 ≤ n ≤ 32
- Response: `03 | IDm (8) | n (1) | n key versions (2 each, little-endian)`, in the same order as the request
- A key version of `FFFF` means the node doesn't exist (Table 4-9). It also comes back for a node whose DES key has been deleted.
- Node code `FFFF` means the System itself (§3.2.2).

**Request System Code (§4.4.8)**
- Command: `0C | IDm (8)`
- Response: `0D | IDm (8) | n (1) | n system codes (2 each)`, listed from System 0 upward

**Read Without Encryption (§4.4.5)**
- Command: `06 | IDm (8) | m (1) | m service codes (2 each, little-endian) | n (1) | block list (2n..3n bytes)`, with 1 ≤ m ≤ 16
- Response: `07 | IDm (8) | status flag 1 | status flag 2 | [n (1) | n × 16 bytes of block data]`
- The block count and block data are present only when status flag 1 = `00`.
- The service code list may name only services that exist and that the block list refers to.
- Readable services are those whose attribute says no authentication is needed; the access mode must be `000`.

## Area and Service codes (UM §3.3.1, §3.4.1, Table 3-2)
- Both are 16 bits: the top 10 bits are the number and the bottom 6 bits the attribute. So `code = number << 6 | attribute`, and numbers run from 0 to 1023.
- Area attributes: `000000` (can hold sub-areas) and `000001` (can't). Area 0 is `0000`, and its end service code is `FFFE` (§3.3.2).
- **Service attributes: odd means no authentication needed, even means a key is needed.**

| Kind | Key required | No key required |
| --- | --- | --- |
| Random, read/write | `001000` (`08`) | `001001` (`09`) |
| Random, read only | `001010` (`0A`) | `001011` (`0B`) |
| Cyclic, read/write | `001100` (`0C`) | `001101` (`0D`) |
| Cyclic, read only | `001110` (`0E`) | `001111` (`0F`) |
| Purse, direct | `010000` (`10`) | `010001` (`11`) |
| Purse, cashback/decrement | `010010` (`12`) | `010011` (`13`) |
| Purse, decrement | `010100` (`14`) | `010101` (`15`) |
| Purse, read only | `010110` (`16`) | `010111` (`17`) |

- The brute-force search asks, for every number 0..1023, about each of the 8 no-key attributes, plus the 8 keyed ones so the dump shows that they exist. That's 16 × 1024 = 16384 nodes, or 512 Request Service commands of 32 nodes each.
- A service's blocks are numbered from 0 to its block count − 1 (§3.4.1).

## Block list elements (UM §4.2.1, §4.2.2)
- **Byte D0:**
  - bit 7 = length: `1` means a 2-byte element, `0` a 3-byte one.
  - bits 6–4 = access mode: `000` for ordinary reads.
  - bits 3–0 = the index of the service in this command's service code list.
- **The block number follows:**
  - 1 byte in a 2-byte element.
  - 2 bytes, little-endian, in a 3-byte element.
  - Block numbers above 255 need the 3-byte form.
- Example from the manual: block 3 of the first listed service is `80 03`.

## Status flags (UM §4.5)
**Status flag 1:**
- `00` means success.
- `FF` means an error not tied to a list.
- Any other value points at the failing list entry. Depending on the product, that's either the entry's index or a bitmap.

**Status flag 2:**
- `00`–`7F` mean the same on every product:
  - `01`/`02`/`03`: purse errors
  - `70`: memory error
  - `71`: rewrite-count warning
- `80`–`FF` are product-specific; use them for debugging only (Table 4-12):
  - `A1`: bad service/node count
  - `A2`: bad block count
  - `A3`: bad service index
  - `A4`: bad service type
  - `A5`: access not allowed
  - `A6`: no such service/node
  - `A7`: bad access mode
  - `A8`: **block number past the service's last block**

The dumper treats any non-zero status as "stop reading this service" and records both flags in the dump. It never branches on a specific `80`–`FF` value.

## Response time from PMm (UM §2.3.4, Table 2-5)
**Which PMm byte applies:**
- D10 (PMm byte 2): Request Service, where n = node count
- D11 (byte 3): fixed-time commands such as Request Response and Request System Code, where n = 0
- D13 (byte 5): Read Without Encryption, where n = block count

**Decoding a byte:**
- bits 7–6 = E
- bits 5–3 = B
- bits 2–0 = A

**Formula:** maximum time = T × ((B + 1) × n + (A + 1)) × 4^E, where T = 256 × 16 / fc ≈ 0.3020 ms.

**Polling's time is different** (§2.3.5): the response comes in time slot k at 2.417 ms + k × 1.208 ms.
