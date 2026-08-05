#!/bin/bash
# Run Verso in SERVER MODE on this machine -- the companion to serve.command, which serves the
# same files with no backend at all. Double-clickable in Finder.
#
# This is what lets you reach the server-mode surfaces (setup, sign-in, the account menu,
# People, the cutover) without standing up IIS. Development only -- to deploy, read
# server/install/RUNBOOK.md.
cd "$(dirname "$0")" || exit 1
exec node scripts/serve-server.js
