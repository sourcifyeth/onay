#!/bin/sh
# Runs as root after the package is installed.
#
# Gives the relay its own group and the setgid bit. The user who runs a
# setgid program cannot trace it and cannot preload code into it. The app
# accepts only a peer that runs with this group (see peer.rs).
set -e

GROUP=onay-relay
RELAY=/usr/bin/onay-relay

getent group "$GROUP" >/dev/null || groupadd --system "$GROUP"
chgrp "$GROUP" "$RELAY"
chmod 2755 "$RELAY"
