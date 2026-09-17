# worm-machinallm-v003-core

Separates MachinaLLM UI from backend selection with a small core architecture.

## Architecture

```text
UI
  -> MachinaRepository
      -> AiProvider
          -> LocalPlaceholderProvider
```

## Packages

- `com.worm.machinallm.core`
- `com.worm.machinallm.model`
- `com.worm.machinallm.provider`
- `com.worm.machinallm.repository`

## Active Provider

- `ProviderType.LOCAL_PLACEHOLDER`

## Excluded

- Network access
- OpenAI implementation
- TermLLM IPC
- Hilt
- Koin
- WebView
