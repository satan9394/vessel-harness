#!/usr/bin/env bash
# Commit-metadata guard (2026-09-27 desensitization).
#
# This repository's history must not carry the personal email address that was
# rewritten out on 2026-09-27. The address is stored as SHA-256 so the guard does
# not re-publish the very string it exists to keep out - including in its own
# error output.
#
# Why this exists: the history rewrite was verified, but commits created *after*
# the rewrite picked the identity back up from the local git config and were
# pushed. Verification of a past state is not protection against the next commit.
#
# Two deliberate scope decisions, both learned from the first real run in CI:
#
#   * Merge commits are skipped (`--no-merges`). GitHub creates a transient merge
#     commit for every pull request (`refs/pull/N/merge`) authored with the
#     account's commit identity; scanning it failed every PR while proving
#     nothing about the repository's own history.
#
#   * GitHub's own noreply address (`<id>+<login>@users.noreply.github.com`) is
#     deliberately NOT denylisted. It derives from public account data (account
#     id + login) and is what GitHub itself authors web-created commits with, so
#     denylisting it would fight the platform for no privacy gain - see design
#     decision 20: the account handle is the public identity of this repository
#     and is out of scope.
#
# Run locally (Git Bash / WSL / Linux / macOS):
#   bash scripts/identity-guard.sh
set -euo pipefail

DENY="
bc0f3464c1b009e8ce804e4bf80d4216f41097322ef453faea445b1a5824d928
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
done < <(git log --no-merges --format='%H %ae%n%H %ce' | sort -u)

if [ "$reported" -gt 20 ]; then
  echo "($((reported - 20)) further offending commits not listed)"
fi

if [ "$fail" -ne 0 ]; then
  echo "This repository's history must not carry the identity removed on 2026-09-27."
  echo "Fix: use a neutral identity in this repository"
  echo "  git config user.name  'Vessel Contributors'"
  echo "  git config user.email 'vessel@users.noreply.github.com'"
  echo "then amend or rewrite the offending commits before pushing."
  exit 1
fi

echo "identity guard: no denylisted commit identities in this history"
