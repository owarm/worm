# worm-machinallm-v007-apk

Builds, signs, verifies, and publishes MachinaLLM `0.1.0` for direct HTTPS installation on Worm OS.

## Artifact

```text
/opt/worm/artifacts/machinallm/0.1.0/MachinaLLM-0.1.0.apk
/opt/worm/artifacts/machinallm/0.1.0/SHA256SUMS
```

## Commands

```sh
./debug.sh
./build.sh
./verify.sh
./publish.sh
```

## Smartphone Install

Sul telefono Worm OS:

1. Aprire l'URL HTTPS:
   `https://releases.coffee.pm/machinallm/MachinaLLM-0.1.0.apk`
2. Scaricare `MachinaLLM-0.1.0.apk`.
3. Consentire l'installazione APK al browser/file manager se richiesto.
4. Installare MachinaLLM.
5. Disabilitare nuovamente il permesso "Installa app sconosciute" se non serve.

No ADB or USB device is required. Release signing uses `/opt/worm/keys/machinallm/` and keeps secrets outside the app repository and patch scripts.
