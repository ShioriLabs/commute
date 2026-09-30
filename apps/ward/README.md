# @commute/ward

A cheap sensor you plant and leave, like the ward in Dota. It watches TransJakarta buses
through an upstream relay's SSE feed, keeps every snapshot, and each night
checkpoints the previous day to R2. The data feeds `apps/api`'s observed-headway
analysis. Why it exists and what it deliberately doesn't do:
[`docs/adr/ward-collector.md`](../../docs/adr/ward-collector.md).

```
relay SSE ──▶ collect.ts ──▶ /var/lib/ward/snap-YYYYMMDD-HH.ndjson.gz   (WIB hours)
                                   │
              00:30 WIB timer ──▶ checkpoint.ts ──▶ archive/snap-YYYYMMDD.ndjson.zst ──▶ R2 raw/YYYY/MM/
                                                                                          │
                                                laptop: pull.ts ◀─────────────────────────┘
                                                        └▶ apps/api analyze:headways
```

## Pieces

| | Runs | Does |
|---|---|---|
| `src/collect.ts` | `ward-collect.service`, always | Holds the SSE stream, appends each snapshot to the current WIB hour's file. Reconnects on drops, stalls and suspends; writes `gap` records for time without snapshots and a `start` record per process start. |
| `src/checkpoint.ts` | `ward-checkpoint.timer`, 00:30 WIB | For every finished day: `zstd -19 --long=27` (≈10× smaller than the gz), upload, verify size + sha256 in R2, write an `.uploaded` marker, and only then delete the hourly files. Keeps local archives 30 days. |
| `src/pull.ts` | your laptop, by hand | Downloads the archives you don't have yet and checks their sha256. |

### Record format

One JSON object per line, one gzip member per line in the hourly files (crash-safe
appends, still readable with `zcat`):

```
{"k":"start","t":ms,"feed":url}
{"k":"s","t":recvMs,"v":[[body, route, nextStop, lat, lon, heading, updMs], ...]}
{"k":"gap","from":ms,"to":ms,"why":"idle 46s"}
```

`updMs` is when the **relay** last heard from that bus, not a GPS time. A snapshot
can arrive on time while its positions are stale, and the collector can't tell.
The analysis judges that per snapshot from how many buses' `updMs` moved.

## Setup

1. **R2:** `wrangler r2 bucket create commute-ward`, then in the dashboard create an
   R2 API token with **Object Read & Write on `commute-ward` only**.
2. **VPS:** 1 vCPU / 1GB / 20GB is plenty (collector ~70MB RSS, ~350MB/day of
   hourly gz before checkpointing). Debian/Ubuntu with systemd.
3. **Deploy** from the repo root:
   ```sh
   rsync -a --delete --exclude node_modules apps/ward/ root@<vps>:/opt/ward/
   ssh root@<vps> /opt/ward/deploy/install.sh
   ```
   The first run creates `/etc/ward.env` from `deploy/ward.env.example`. Fill it in
   (the feed URL lives only there, never in the repo) and run `install.sh` again. It is
   idempotent, so the same two commands are also how you ship updates.

## Operations

```sh
journalctl -u ward-collect -f              # live collector log
journalctl -u ward-checkpoint --since today
systemctl start ward-checkpoint            # run a checkpoint now (safe any time)
systemctl list-timers ward-checkpoint.timer
sudo -u ward node src/checkpoint.ts --dry-run   # compress + verify only, no upload/delete
```

On the laptop:

```sh
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
  pnpm --filter @commute/ward pull --out ~/ward-archive
pnpm --filter @commute/api analyze:headways --dir ~/ward-archive --days 30
```

### When something goes wrong

- **Checkpoint failed:** nothing was deleted. The log line says why; the next night
  retries, or run `systemctl start ward-checkpoint` once it's fixed.
- **`quarantine/` has files:** an hourly file had a truncated gzip member (the
  process was killed mid-append). The day was archived up to the damage and the
  originals were moved aside, not deleted. Inspect them with `zcat` (it prints everything
  before the bad member) and delete them once you're satisfied.
- **Disk filling up:** checkpoints are failing. Hourly gz only goes away after a
  verified upload.

## Development

```sh
pnpm --filter @commute/ward test        # needs zcat + zstd on PATH
pnpm --filter @commute/ward typecheck
WARD_FEED_URL=… WARD_DATA_DIR=/tmp/ward node apps/ward/src/collect.ts
```

Node ≥ 24 runs the TypeScript directly (type stripping), so there is no build step.
Only erasable syntax is allowed, and imports name the `.ts` file.
