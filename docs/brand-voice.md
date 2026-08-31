# Brand voice

**Status:** reference guide, extracted from existing in-app copy (Aug 2026). Not a
rewrite — this names the register that's already dominant in the newest strings so
future copy converges on it instead of adding a fourth variant.

## Why

Copy has accumulated over ~2 years with no shared reference. Three registers ended
up coexisting: formal "Anda" (oldest UI strings, plus legal boilerplate where it's
correct), casual "Kamu" (newer offline/error banners), and a specific playful
Jakarta-commuter voice (the About page, `boot-watchdog.ts`). The last one is where
new copy should land — it's the newest, and its own code comment says so directly
(`boot-watchdog.ts:57`: "Indonesian, matching the app's register").

## The voice, in one line

Talk like a friend who rides the same line — casual Jakarta Indonesian, "Kamu" not
"Anda", plainspoken about what broke and what to do about it. Personality is
welcome, but it's reserved for copy that isn't interrupting a task.

## Two registers, by context

### Functional copy — errors, loading, empty states, labels

Calm and utilitarian. State what happened, then what to do. No apology theater, no
exclamation marks, no emoji.

- **Pronoun:** "Kamu", never "Anda".
- **Loading:** present-continuous verb + ellipsis — `Memuat...`, `Menghitung
  tarif...`, `Memuat peta...`.
- **Errors/empty states:** short title (2-4 words, Title Case) + one plain sentence,
  e.g. `Gagal Memuat Jadwal` / `Terjadi kesalahan saat memuat data. Silakan coba
  lagi` (`empty-state.tsx`). When there's a real fallback, say it instead of just
  apologizing — `NO_SCHEDULE`'s `Lihat papan keberangkatan atau tanyakan pramusapa`
  beats a dead-end "tidak tersedia".
- **CTAs:** short imperative, Title Case — `Coba Lagi`, `Kembali`, `Cek Tarif`.
- **A little warmth is fine** — a trailing "ya" softens without turning it into a
  joke: `Lama banget ya? Coba muat ulang` (`boot-watchdog.ts:59`).

### Voice copy — About page, onboarding, anything read start-to-finish

Full personality. Self-aware Jakarta-commuter humor, sentence-final particles
(gak, banget, pengen, bikin), parenthetical asides for the wink instead of a
front-loaded joke.

- `Aplikasi Jadwal Kereta Buat Anak Jakarta` (`about.tsx:56`)
- `Dibuat dengan perasaan cinta, layaknya dapet kursi kosong di rush hour Sudirman`
  (`about.tsx:61`) — the Sudirman-rush-hour bit is a running motif. Reach for it (or
  another shared-commuter-pain beat) before inventing a new joke from scratch.
- `(tidak menerima curhatan soal percintaan)` (`about.tsx:68`) — the parenthetical
  aside is the shape to copy, not the specific line.

## Exception: legal pages

`privacy-policy.tsx`, `terms-conditions.tsx`, `data-attributions.tsx` keep formal
"Anda" and full legalese. That's deliberate, not debt — don't casual-ify
contractual text.

## Examples, by category

| Category | Copy | Location |
|---|---|---|
| Loading | `Memuat...` / `Menghitung tarif...` / `Memuat peta...` | `boot-watchdog.ts:58`, `fare-summary.tsx:27`, `map.tsx:2660` |
| Error (title + body) | `Gagal Memuat Jadwal` / `Terjadi kesalahan saat memuat data. Silakan coba lagi` | `empty-state.tsx:15-16` |
| Error, inline | `Gagal memuat aplikasi. Coba muat ulang` | `boot-watchdog.ts:61` |
| Offline banner | `Kamu sedang offline, data mungkin tidak up-to-date` | `station-content.tsx:255`, `timetable-content/index.tsx:212` |
| Offline, no-hydrate | `Kamu lagi offline dan datanya belum tersimpan. Sambungin internet dulu, ya` | `boot-watchdog.ts:60` |
| Empty state w/ fallback | `Jadwal Tidak Tersedia` / `Lihat papan keberangkatan atau tanyakan pramusapa` | `empty-state.tsx:23-25` |
| CTA | `Coba Lagi`, `Kembali`, `Cek Tarif` | throughout |
| Voice/marketing | `Aplikasi Jadwal Kereta yang dibikin biar kita gak perlu buka 4 aplikasi cuma buat cek kereta berikutnya` | `about.tsx:58` |

## Known gaps

Strings that still use the old formal register and haven't been swept yet:

- `home.tsx:62` — `Silakan coba lagi beberapa saat lagi saat jaringan Anda
  tersambung`, same text as the old `empty-state.tsx` copy, duplicated locally
  rather than importing the component. Worth deduplicating separately from the
  voice fix.

`empty-state.tsx`'s "Anda" was fixed to "Kamu" alongside this doc (2026-08-31).
