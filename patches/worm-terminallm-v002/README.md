# Worm TermLLM Runtime Installer v002

This patch installs and manages the official `term-llm` release binary for Worm
OS. It is separate from `worm-terminallm-v001`, which provides the Worm wrapper,
configuration, data directory, log directory, and XDG isolation.

## Relationship With v001

v001 owns:

```text
/opt/worm/terminallm/bin/worm-llm
/opt/worm/terminallm/config/
/opt/worm/terminallm/data/
/opt/worm/terminallm/logs/
```

v002 owns only the runtime installer surface:

```text
/opt/worm/patches/worm-terminallm-v002/
/opt/worm/terminallm/runtime/
/opt/worm/backups/worm-terminallm-v002/
/usr/local/bin/term-llm
```

The v001 wrapper finds `term-llm` through `PATH`; v002 provides that command by
linking `/usr/local/bin/term-llm` to the isolated runtime binary.

## Directory Structure

```text
/opt/worm/patches/worm-terminallm-v002/
├── VERSION
├── README.md
├── debug.sh
├── install.sh
├── uninstall.sh
└── update.sh

/opt/worm/terminallm/runtime/
├── .gitignore
├── bin/
├── releases/
├── tmp/
└── install-state
```

Downloaded archives, temporary files, the installed binary, and machine-local
state are ignored by git.

## VERSION

`VERSION` contains:

```bash
TERM_LLM_VERSION=latest
```

Set it to a stable tag to pin a release:

```bash
TERM_LLM_VERSION=v0.9.48
```

`install.sh` and `update.sh` always read this file. They do not rewrite it.

## Install

```bash
cd /opt/worm/patches/worm-terminallm-v002
sudo ./install.sh
```

The installer resolves the requested release, downloads the official GitHub
release artifact into `/opt/worm/terminallm/runtime/tmp/`, verifies checksum
metadata when upstream publishes it, extracts into a temporary directory,
validates the binary, stages it as `.term-llm.new`, then atomically installs it
as:

```text
/opt/worm/terminallm/runtime/bin/term-llm
```

## Update

```bash
sudo ./update.sh
```

`update.sh` compares the installed version with the resolved requested version.
If they match, it prints `[OK] already up to date`. If they differ, it performs
the same verified staged install flow as `install.sh`.

## Debug

```bash
./debug.sh
```

The debug script checks platform detection, GitHub connectivity, release
resolution, runtime and backup directories, binary presence, executable bit,
binary size, symlink target, v001 wrapper presence, install state, config, and
`OPENAI_API_KEY` presence without printing its value.

## Uninstall

```bash
sudo ./uninstall.sh
```

The uninstaller removes only v002-owned files when
`/opt/worm/terminallm/runtime/install-state` confirms this patch installed them.
It does not remove v001, `config/env`, `config/config.yaml`, user data, or logs.

## Rollback

During install/update, failures trigger rollback. The scripts keep the previous
binary usable, avoid leaving `/usr/local/bin/term-llm` pointed at a missing
target, and remove temporary files.

## Backup

Before replacing an existing runtime binary or `/usr/local/bin/term-llm`, the
scripts copy it to:

```text
/opt/worm/backups/worm-terminallm-v002/
```

Backups are not committed to git.

## Security

This patch does not install credentials and does not read or print secret
values. API keys remain owned by the v001 configuration flow and must stay in
the ignored local file:

```text
/opt/worm/terminallm/config/env
```

## Checksum Behavior

Upstream currently publishes `checksums.txt` in each release. When available,
the installer downloads it, finds the exact line for the selected artifact, and
verifies the archive with `sha256sum`. A mismatch aborts installation.

If a future upstream release does not publish checksums, the scripts print:

```text
[WARN] upstream checksum not available
```

and continue only after documenting that status in `install-state`.

## Symlink Handling

`/usr/local/bin/term-llm` is managed safely:

```text
missing                         -> create symlink
already points to runtime binary -> leave unchanged
points elsewhere                -> backup before replacing
real file                       -> backup before replacing
```
