# worm-machinallm-v004-service

Adds the local Android Service foundation for MachinaLLM.

## Service

- `com.worm.machinallm.service.MachinaLlmService`
- Android `Service`
- `android:exported="false"`
- Local binder only
- Active provider: `ProviderType.LOCAL_PLACEHOLDER`

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

## Excluded

- Privileged system service
- Signature permissions
- System UID
- sharedUserId
- Network access
- OpenAI implementation
- TermLLM IPC
