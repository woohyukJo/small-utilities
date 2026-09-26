# Windows 0.2.1 repair verification

Date: 2026-09-26. This repair affects the Windows client only. Android's generated probe and day triggers were not changed.

## Changes

- Saving the already-selected conversation now returns to that conversation if another page is open. It still avoids a redundant database write.
- Locked conversation pinning handles both full-document and in-page navigation, with a reentrancy guard. Authentication remains exempt while active.
- The page probe supports additional composer selectors, standalone `data-turn` sections, and grouped `data-turn-key` messages with role-specific identities. Submission baselines include virtualized wrappers; message bodies are not exported.

## Evidence and validation

The installed 0.2.0 client was running in managed mode with the expected service and persisted target. Its probe repeatedly reported no composer and zero user/assistant messages. Isolated Chromium fixtures reproduced missing detection for the added structures.

The repair passed 68 native checks, 26 TypeScript tests, named-pipe/SQLite integration, peer TLS integration, hidden WebContentsView DOM tests, and shell/preload UI tests. The 0.2.1 installer payload passed distribution validation (290 ASAR entries).

The 0.2.1 installer completed successfully at the existing installation location. Installed ASAR and guard hashes matched the build; the service was running at the expected path. The actual managed app then detected the composer, five user messages and five completed assistant responses. Historical messages left today's count at zero. The selected target, revision, password configuration and emergency-unlocked state were preserved. No real conversation messages were sent by the agent and today's gate was not reset.

The user then sent a period and reported that its response finished. The live submission signal increased from zero to one. The snapshot still contained five user/assistant pairs, so this point-in-time diagnostic alone does not prove a new tracker completion event; the current diagnostic phase is overwritten on each observation. Daily count correctly remained zero in the existing emergency-unlocked state.

## Remaining acceptance

Saving a changed target through the visible UI, locked SPA/full-page pinning, fresh turns 0→1→2→3, quiet unlock, ESC and tray Exit still require live acceptance. Synthetic tests and the recovered live snapshot do not establish that entire sequence. The GitHub release remains 0.2.0 until a separate release action; 0.2.1 is locally built and installed.
