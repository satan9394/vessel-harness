#!/usr/bin/env bash
# Commit-metadata guard (2026-09-27 desensitization).
#
# This repository's history must not carry the personal identities that were
# rewritten out on 2026-09-27. The addresses are stored as SHA-256 so the guard
# does not re-publish the very strings it exists to keep out - including in its
# own error output.
#
# Why this exists: the history rewrite was verified, but commits created *after*
# the rewrite picked the identity back up from the local git config and were
# pushed. Verification of a past state is not protection against the next commit.
#
# Run locally (Git Bash / WSL / Linux / macOS):
#   bash scripts/identity-guard.sh
set -euo pipefail

DENY="
bc0f3464c1b009e8ce804e4bf80d4216f41097322ef453faea445b1a5824d928
abdfc578704e83b1d71ad6f396a36df70b8e07308fb3755127d6b33054443f36
"

fail=0
reported=0
while read -r sha mail; do
  [ -n "${sha:-}" ] || continue
  h=$(printf '%s' "$mail" | tr 'A-Z' 'a-z' | sha256sum | cut -d' ' -f1)
  for d in $DENY; do
    if [ "$h" = "$d" ]; then
      # Cap the listing: a fully unscrubbed history has one offender per commit
      # and would otherwise bury every other CI log line.
      if [ "$reported" -lt 20 ]; then
        echo "::error::commit $sha uses a denylisted identity (email sha256 ${h:0:12}...)"
      fi
      reported=$((reported + 1))
      fail=1
    fi
  done
done < <(git log --format='%H %ae%n%H %ce' | sort -u)

if [ "$reported" -gt 20 ]; then
  echo "($((reported - 20)) further offending commits not listed)"
fi

if [ "$fail" -ne 0 ]; then
  echo "This repository's history must not carry the identities removed on 2026-09-27."
  echo "Fix: use a neutral identity in this repository"
  echo "  git config user.name  'Vessel Contributors'"
  echo "  git config user.email 'vessel@users.noreply.github.com'"
  echo "then amend or rewrite the offending commits before pushing."
  exit 1
fi

echo "identity guard: no denylisted commit identities in this history"
