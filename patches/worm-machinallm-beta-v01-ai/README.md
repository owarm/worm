# worm-machinallm-beta-v01-ai

Project: `/opt/worm/apps/com.worm.machinallm`

Patch path: `/opt/worm/patches/worm-machinallm-beta-v01-ai`

Prerequisites:

- `worm-machinallm-beta-v01-ssh`
- `worm-machinallm-beta-v01-sftp`

## Goal

Integrate an AI panel in MachinaLLM without embedding an OpenAI API key in the Android app.

Architecture:

```text
MachinaLLM Android
  -> SSH
  -> VPS
  -> term-llm
  -> OpenAI
```

## Implemented

- Main navigation now has `Terminal`, `Files`, and `AI`.
- `AiScreen` provides a USER/ASSISTANT conversation list, prompt input, send button, and progressive stdout display.
- `AiRemoteManager` uses the active SSH session.
- Remote detection runs `command -v term-llm`.
- If missing, UI shows `term-llm not available on remote host`.
- AI invocation runs `term-llm` and sends user prompt through stdin.
- No user prompt is concatenated into a shell command.
- No CLI flags are invented.
- No direct OpenAI call is made from Android.
- No API key is stored in the app.

## Context Actions

Terminal:

- `Ask AI`
- user explicitly chooses `Last 1K` or `Last 4K`
- selected excerpt is previewed before it becomes an AI prompt
- full terminal buffer is never sent automatically

Files:

- text viewer exposes `Explain`, `Summarize`, and `Fix`
- visible file content is passed to the AI preview only after the user taps one of those actions
- AI send still requires the user to confirm/use the preview

## Privacy

The AI panel clearly states that sent content goes to `term-llm` on the remote host and may be sent to the configured AI provider.

Sensitive marker filter checks:

- OpenAI API key assignment marker
- `PRIVATE KEY`
- `PASSWORD=`
- `TOKEN=`

If detected, sending is blocked and the user is asked to remove sensitive content.

## Error Mapping

- `credit_balance_exhausted` -> `OpenAI API credits exhausted`
- `insufficient_quota` -> `OpenAI API credits exhausted`
- authentication/invalid key/unauthorized -> `OpenAI API authentication failed`
- network errors -> `Network error from remote AI backend`
- timeout -> `AI request timed out`
- missing SSH session -> `Connect to a host first`

## Streaming

Streaming support is not assumed from the `term-llm` CLI. The app reads stdout progressively and displays chunks as they arrive. If the installed `term-llm` buffers output, the response appears complete at the end.

Detected streaming support at build time: no. Runtime behavior depends on the remote `term-llm` binary.

## Build

```bash
cd /opt/worm/apps/com.worm.machinallm
./gradlew assembleDebug
```

Debug APK:

`/opt/worm/apps/com.worm.machinallm/app/build/outputs/apk/debug/app-debug.apk`

## Scripts

- `apply.sh`: verifies the AI patch and prerequisites are present.
- `revert.sh`: non-destructive revert guidance.
- `build.sh`: runs `./gradlew assembleDebug`.
- `debug.sh`: verifies AI panel, term-llm detection, stdin invocation, context actions, privacy checks, and APK metadata.
