#!/usr/bin/env bash
# Idempotent VPS bootstrap for ward. Run as root from /opt/ward after syncing
# the app there (see apps/ward/README.md). Safe to re-run on every deploy.
set -euo pipefail

APP_DIR=/opt/ward
DATA_DIR=/var/lib/ward
ENV_FILE=/etc/ward.env

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
cd "$APP_DIR"

echo "== packages"
apt-get update -qq
apt-get install -y -qq zstd ca-certificates curl gzip >/dev/null

echo "== node >= 24"
if ! command -v node >/dev/null || (( $(node -p 'process.versions.node.split(".")[0]') < 24 )); then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

echo "== user and directories"
id ward >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin ward
install -d -o ward -g ward -m 750 "$DATA_DIR"

echo "== swap (1GB box: the checkpoint's zstd window plus node needs headroom)"
if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== dependencies"
npm install --omit=dev --no-audit --no-fund --silent

echo "== env"
if [[ ! -f $ENV_FILE ]]; then
  install -m 600 -o root -g root deploy/ward.env.example "$ENV_FILE"
  echo "created $ENV_FILE from the example: fill it in, then re-run this script" >&2
fi

echo "== systemd"
install -m 644 deploy/ward-collect.service deploy/ward-checkpoint.service deploy/ward-checkpoint.timer /etc/systemd/system/
systemctl daemon-reload

# Don't start a collector that would crash-loop on a blank feed URL.
if grep -Eq '^WARD_FEED_URL=.+' "$ENV_FILE"; then
  systemctl enable --now ward-collect.service
  systemctl restart ward-collect.service
  systemctl enable --now ward-checkpoint.timer
  systemctl --no-pager --lines=5 status ward-collect.service || true
  systemctl list-timers ward-checkpoint.timer --no-pager
else
  echo "WARD_FEED_URL is empty in $ENV_FILE; services installed but not started" >&2
fi
