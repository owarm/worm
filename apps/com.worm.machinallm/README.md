# MachinaLLM

Native Android base for MachinaLLM on Worm OS.

## Scope

- Kotlin
- Jetpack Compose
- Material 3
- Android Dynamic Colors when available
- No OpenAI integration
- No networking
- No secrets
- No WebView
- No TermLLM dependency
- No Android permissions

## Architecture

```text
MachinaLLM UI
       ↓
MachinaLLM Service
       ↓
MachinaRepository
       ↓
AiProvider
       ├── LocalPlaceholder
       ├── future OpenAI
       └── future TermLLM
```

`MachinaLlmService` is a local, non-exported Android Service. It is not a privileged system service and does not expose a public API to other apps.

## Build

```sh
./gradlew assembleDebug
```
