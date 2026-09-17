# GrapheneOS Fastboot Vendor Attribution

This vendored Fastboot engine is derived from the MIT-licensed Fastboot/ZIP implementation used by the GrapheneOS Web Installer bundle (`static/js/fastboot/ffe7e270/fastboot.min.mjs`) and the `android-fastboot` MIT-licensed distribution.

Local Worm changes are limited to factory image layout detection, direct GrapheneOS install ZIP `script.txt` execution, clear unsupported-layout errors, and progress labels for the Worm installer UI.

See `GRAPHENE_FASTBOOT_LICENSE.txt` for the upstream MIT license text.
