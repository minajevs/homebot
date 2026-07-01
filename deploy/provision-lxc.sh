#!/usr/bin/env bash
#
# Create an unprivileged Debian LXC for the Telegram home bot.
# Run this ON THE PROXMOX HOST as root.
#
# Edit the variables below, then:
#   bash provision-lxc.sh
#
set -euo pipefail

# ---- Settings you may want to change --------------------------------------
CTID="${CTID:-201}"                 # Unused container ID
HOSTNAME="${HOSTNAME:-homebot}"
CORES="${CORES:-1}"
MEMORY_MB="${MEMORY_MB:-512}"       # 512 MB is plenty for a polling bot
SWAP_MB="${SWAP_MB:-512}"
DISK_GB="${DISK_GB:-4}"
STORAGE="${STORAGE:-local-lvm}"     # Container rootfs storage
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"  # Where templates live
BRIDGE="${BRIDGE:-vmbr0}"
# IP: "dhcp" or e.g. "192.168.1.50/24" (set GATEWAY too if static)
IP="${IP:-dhcp}"
GATEWAY="${GATEWAY:-}"
# Debian 13 (trixie). Change to a template you have if needed.
TEMPLATE_NAME="${TEMPLATE_NAME:-debian-13-standard_13.1-1_amd64.tar.zst}"
# ---------------------------------------------------------------------------

echo ">> Refreshing template list"
pveam update >/dev/null 2>&1 || true

TEMPLATE_REF="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}"
if ! pveam list "${TEMPLATE_STORAGE}" | grep -q "${TEMPLATE_NAME}"; then
  echo ">> Downloading template ${TEMPLATE_NAME}"
  pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE_NAME}"
fi

NET="name=eth0,bridge=${BRIDGE},ip=${IP}"
if [[ "${IP}" != "dhcp" && -n "${GATEWAY}" ]]; then
  NET="${NET},gw=${GATEWAY}"
fi

echo ">> Creating unprivileged container ${CTID} (${HOSTNAME})"
pct create "${CTID}" "${TEMPLATE_REF}" \
  --hostname "${HOSTNAME}" \
  --cores "${CORES}" \
  --memory "${MEMORY_MB}" \
  --swap "${SWAP_MB}" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "${NET}" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --start 1

echo ">> Waiting for the container to come up"
sleep 5
pct exec "${CTID}" -- bash -lc 'until ping -c1 -W2 deb.debian.org >/dev/null 2>&1; do sleep 2; done; echo network-ok'

echo
echo "Container ${CTID} is up. Enter it with:  pct enter ${CTID}"
echo "Then run the in-container installer (deploy/install.sh)."
