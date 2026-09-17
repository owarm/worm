worm-os-home-product-integration-v005

Purpose: include Worm Home in the frankel Worm OS image as a standard system_ext app.

Scope:
- Fix Worm Home applicationId to com.worm.home.
- Keep Java namespace/package com.worm for existing source compatibility.
- Add a Soong module named WormHome under external/WormHome.
- Add WormHome to frankel PRODUCT_PACKAGES.
- Do not make WormHome privileged and do not assign platform signature.

Build target:
DEVICE=frankel
BUILD_TARGET=cp2a
BUILD_VARIANT=user

Result:
WormHome builds through Soong and is present in system_ext/app/WormHome/WormHome.apk.
