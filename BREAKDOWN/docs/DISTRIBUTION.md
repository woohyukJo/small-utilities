# BREAKDOWN distribution notes

BREAKDOWN is developed in the `woohyukJo/small-utilities` repository under `BREAKDOWN/`. The repository is the source of truth; `release/` is generated Windows packaging output and is ignored by Git. An installer is a build artifact, not the source tree, and a successful source build does not imply that a new installer has been installed on the machine.

## Build ownership and environments

The Windows desktop build is produced on Windows. The current desktop toolchain requires Node.js 24+, the Windows Electron toolchain, .NET 10 SDK, and NSIS/electron-builder integration used by `scripts/build.ps1`. The existing Ubuntu WSL 2 clone at `/home/mymemeisjo/projects/small-utilities` is useful as the Git working copy and for future Android work, but its default Node.js is 18.19.1/npm 9.2.0. Do not treat a WSL desktop build as validated unless that environment is deliberately upgraded and the Windows-specific packaging path is separately verified.

Windows and WSL working copies should exchange changes through Git commits/push/pull. A release build should come from the Windows working copy at the intended commit.

## Source, generated output, and local state

The following are different classes of data:

- Source: tracked files in `BREAKDOWN/`.
- Generated desktop output: `dist/`, `artifacts/`, and `release/`. These can contain stale files from an older source state unless the build cleans them.
- Local runtime state: `%ProgramData%\BREAKDOWN\gate.db` and `%LOCALAPPDATA%\BREAKDOWN\browser`. They are not release inputs and must not be copied into a clean build.
- Optional local legacy backup: ignored `src/conversation-target.json`. A clean clone must build without it. When it exists locally, `scripts/check-distribution.cjs` uses its exact conversation/project values only as a negative leak check and never prints those values.

The runtime-target refactor is complete only when a clean checkout with no private target JSON can build and run its tests. Runtime conversation selection belongs in application state/SQLite, not in tracked source or packaged resources.

## Legacy packaging cleanup

At the time these notes were written, `package.json` packaged `dist/**/*` while excluding tests and `dist/dom-smoke.js`. TypeScript's `outDir` does not itself remove files left by older builds. The pre-refactor `dist/conversation-target.json` therefore survived and the existing 0.1.8 `release/win-unpacked/resources/app.asar` still contains it.

Version 0.1.9 removes the two obsolete generated target JSON files before building and explicitly excludes `dist/conversation-target*.json` in electron-builder. The distribution checker runs at the end of `scripts/build.ps1` and fails the build if a legacy target, project source/tests, or `.dev` material enters the ASAR.

Do not remove or rewrite the user's live `%ProgramData%` DB or browser profile as part of this cleanup.

## Distribution checker

Run after a Windows `win-unpacked` package has been produced:

```powershell
node scripts/check-distribution.cjs
```

An alternate unpacked directory can be supplied explicitly:

```powershell
node scripts/check-distribution.cjs C:\path\to\win-unpacked
```

The checker is read-only. It uses the already installed `@electron/asar` package and verifies:

- packaged `package.json` version equals the repository root `package.json` version;
- `dist/main.js`, the three UI files, and `resources/guard/Breakdown.Guard.exe` are present;
- no `conversation-target.json` / `conversation-target.example.json`, app `src/`, tests, or `.dev` tree is present in the ASAR;
- when ignored `src/conversation-target.json` exists locally, its exact private conversation/project IDs are absent from the ASAR, native guard resources, packaged docs, and recovery script. Failures identify the class of leak without printing the ID.

The checker intentionally does not inspect the NSIS installer's compression format. `release/win-unpacked` is the canonical package payload for this check; the installer's version/hash are checked separately in the release checklist.

## Clean-clone release flow after the runtime-target refactor

On Windows, from a clean checkout of the intended commit:

```powershell
npm ci
node node_modules/electron/install.js
.\scripts\build.ps1 -Installer
node scripts/check-distribution.cjs
```

`scripts/build.ps1 -Installer` runs the native tests/build, desktop tests, IPC/DOM and hidden shell checks, electron-builder packaging, then the distribution check. A successful exit establishes that these checks passed for the produced payload; it does not install the app.

## 0.1.9 release checklist

Before publishing a release, verify all of the following against the same commit:

1. Root `package.json`, lockfile metadata, displayed product version, unpacked app version, installer filename, blockmap, and `SHA256SUMS.txt` all identify version `0.1.9` consistently.
2. A clean clone without `src/conversation-target.json` passes the full Windows build/test flow.
3. `node scripts/check-distribution.cjs` reports `OK` for the newly generated `release/win-unpacked` payload.
4. The packaged app contains runtime conversation selection and migration behavior; no private target is compiled into Electron or native guard output.
5. Only the intended new installer/blockmap and matching checksum file remain in `release/` after the existing prune step.
6. If a GitHub Release is created in the shared `small-utilities` repository, use the product-scoped tag `breakdown-v0.1.9`. The repository already has a different utility's `maczipcleaner-v1.0.0` tag, so the scoped prefix avoids tag-name collisions and keeps releases identifiable.
7. Installation/updating the live app is a separate coordinator step after artifact review; building and checking the installer does not alter the installed service, DB, or browser profile.
