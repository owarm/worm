# Worm TermLLM Integration v001

This patch adds an optional, isolated `term-llm` integration for Worm OS.
It prepares configuration, local state directories, a wrapper command, debug
checks, and uninstall support without installing `term-llm` itself.

## Installation

Run:

```bash
/opt/worm/patches/worm-terminallm-v001/install.sh
```

The installer is idempotent and safe to rerun. Before replacing an existing
managed file, it stores a backup under:

```text
/opt/worm/backups/worm-terminallm-v001/
```

If `/usr/local/bin` is writable, the installer creates:

```text
/usr/local/bin/worm-llm -> /opt/worm/terminallm/bin/worm-llm
```

It does not install the `term-llm` executable. That must be handled by a
separate patch.

## Configuration

The main configuration is:

```text
/opt/worm/terminallm/config/config.yaml
```

It sets OpenAI as the default provider, reads the API key only from the
`OPENAI_API_KEY` environment variable, uses `/opt/worm` as the workspace, and
keeps data and logs inside `/opt/worm/terminallm/`.

To configure credentials locally, copy the example shape into:

```text
/opt/worm/terminallm/config/env
```

The file must contain:

```bash
OPENAI_API_KEY=
```

Fill it locally only. The real `config/env` file is ignored by git and should
have mode `0600`.

## Debug

Run:

```bash
/opt/worm/patches/worm-terminallm-v001/debug.sh
```

The debug script checks directories, permissions, symlinks, config values,
`term-llm` availability, `OPENAI_API_KEY` presence without printing the value,
`XDG_CONFIG_HOME`, workspace accessibility, and wrapper syntax.

## Uninstall

Run:

```bash
/opt/worm/patches/worm-terminallm-v001/uninstall.sh
```

The uninstaller removes only files created by this patch when they still match
the patch content. It does not delete `config/env` if it contains user
credentials and it does not remove user data or logs.

Where possible, it restores previous files from the patch backup directory.

## File Structure

```text
/opt/worm/terminallm/
├── bin/
│   └── worm-llm
├── config/
│   ├── config.yaml
│   └── env.example
├── data/
│   └── .keep
├── logs/
│   └── .keep
├── xdg/
└── .gitignore

/opt/worm/patches/worm-terminallm-v001/
├── README.md
├── debug.sh
├── install.sh
└── uninstall.sh
```

## Security Notes

No API keys or credentials are included in this patch. `OPENAI_API_KEY` is read
only from the environment or from the optional local
`/opt/worm/terminallm/config/env` file. That file is ignored by git and should
remain private with `0600` permissions.
