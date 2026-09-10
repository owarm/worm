# WormOS Timeline

Base:
- GrapheneOS stable 2026080500
- Android 17
- Pixel 10
- Codename: frankel

Branch:
- wormos/frankel-17

Rules:
- GrapheneOS stock remains unchanged.
- WormOS modifications are applied as patches/overlays.
- Each patch must be committed and tagged before build integration.
- Build identity material remains outside the repository.

## Patch policy

Each WormOS patch must be isolated and versioned independently.

Required flow for every patch:

1. Create dedicated patch directory:
   patches/PATCH-NNN-name/

2. Add patch files, README, apply/verify scripts.

3. Commit only that patch.

4. Create an annotated tag with the same patch identifier:
   patch/PATCH-NNN-name

5. Push branch and tag to GitHub.

6. Only after the tag exists remotely, apply the patch to the GrapheneOS working tree.

7. Record result and verification in this timeline.

No two independent patches may share the same release tag.
