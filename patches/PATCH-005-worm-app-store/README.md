# PATCH-005 - Worm App Store

Replaces the GrapheneOS Apps prebuilt with the Worm Apps client.

Target:
  external/AppStore/prebuilt/app-release.apk

The Worm Apps client must be built from GrapheneOS/AppStore with:

  REPO_BASE_URL
  REPO_PUBLIC_KEY
  REPO_KEY_VERSION

This patch does not store private signing keys.
