#!/usr/bin/env sh
# agent-orchestrator-kit pre-commit gate — runs gate-check against staged files.
# Disable: remove the marked line from .husky/pre-commit, or `git config --unset core.hooksPath`.
npx agent-orchestrator-kit gate-check --staged
