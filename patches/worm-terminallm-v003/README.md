# Worm TermLLM Configuration v003

This patch configures the existing Worm OS `term-llm` integration for the
OpenAI provider. It depends on v001 for the `worm-llm` wrapper and v002 for the
installed `term-llm` runtime binary.

It does not reinstall or update `term-llm`.

## Install

```bash
cd /opt/worm/patches/worm-terminallm-v003
sudo ./install.sh
```

The installer verifies v001, v002, the runtime binary, and the wrapper. It then
creates a persistent config at:

```text
/opt/worm/terminallm/config/config.yaml
```

The effective term-llm path is:

```text
$XDG_CONFIG_HOME/term-llm/config.yaml
/opt/worm/terminallm/xdg/term-llm/config.yaml
```

## Configure Secret

```bash
sudo ./configure.sh
```

The secret file is:

```text
/opt/worm/terminallm/config/env
```

It uses:

```bash
OPENAI_API_KEY=...
```

The API key is read silently with no echo, is never printed, and must not be
committed. The file mode is enforced as `0600`.

## Debug

```bash
./debug.sh
```

Debug checks the `term-llm` path/version, wrapper, config location, XDG config
target, provider configuration, config parsing, env file permissions, secret
presence without value disclosure, git ignore status, v002 state, and symlink.

## Offline Test

```bash
./test.sh
```

The offline test does not call OpenAI. It checks the binary, help output,
wrapper, config parsing, environment file, XDG path, permissions, and git
secret safety.

## Online Smoke Test

```bash
./test.sh --online
```

The online smoke test runs only when `OPENAI_API_KEY` is configured. It can use
OpenAI API quota. It sends only this static prompt:

```text
Reply with exactly:
WORM_LLM_OK
```

It does not send Worm source, git diffs, configs, logs, hostnames, usernames,
directory listings, device identifiers, or the API key.

## Uninstall

```bash
sudo ./uninstall.sh
```

Uninstall restores the previous config backup when available. It does not remove
`/opt/worm/terminallm/config/env`, v001, v002, the runtime binary, user data, or
logs.

## Config

For `term-llm 0.9.48`, the supported config format is YAML under
`$XDG_CONFIG_HOME/term-llm/config.yaml`. v003 installs:

```yaml
default_provider: openai
providers:
  openai:
    model: gpt-5.6-sol
    fast_model: gpt-5.6-luna
    use_websocket: false
```

The OpenAI credential comes only from `OPENAI_API_KEY`; it is not stored in
`config.yaml`.
