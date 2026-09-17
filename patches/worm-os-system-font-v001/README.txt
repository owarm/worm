PATCH: worm-os-system-font-v001

Objective:
Integrate the existing locally available Worm OS font as Android system font preference while preserving GrapheneOS/AOSP fallback.

Fonts used:
- vendor/worm/fonts/local/PragmataPro-Regular.ttf
- vendor/worm/fonts/local/PragmataProMono-Regular.ttf

No font was downloaded or embedded from outside the server.
No emoji, CJK, RTL, Noto, or framework fonts.xml font files were modified.

Strategy:
- Product partition installs Worm font files through vendor/worm/fonts/Android.bp and fonts.mk.
- product/etc/fonts_customization.xml defines Worm as preferred for sans-serif and monospace.
- sans-serif family-list falls back to Roboto weights/styles explicitly.
- monospace family-list falls back to DroidSansMono explicitly.
- Framework fonts.xml remains unchanged, so Noto, emoji, CJK, RTL and language-specific fallback remain available below the normal Android fallback chain.

Validation:
- XML parsed successfully with Python ElementTree.
- fc-scan accepted both local Worm font files.
- No /opt path references were found in font config/build files.
- Incremental build succeeded for WormPragmataProRegular, WormPragmataProMonoRegular, WormPragmataFontsCustomization.
- Output installed to product/fonts and product/etc/fonts_customization.xml.
