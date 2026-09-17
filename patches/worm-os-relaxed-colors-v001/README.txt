PATCH: worm-os-relaxed-colors-v001

Objective:
Integrate Worm OS Relaxed-inspired Dynamic Colors at Android/Material You system level.

Implementation:
- ColorScheme now uses the Worm Relaxed dynamic color layer as its default/base behavior.
- RelaxedDynamicScheme supplies pastel/desaturated palettes while keeping wallpaper seed extraction, Android 17 DynamicScheme, contrast level, platform/spec version, and dark/light token generation intact.
- ThemeOverlayController already generates fabricated framework dynamic-color overlays for accent, neutral, dynamic, fixed, and custom SystemUI colors; the patched ColorScheme feeds those overlays system-wide.

Palette anchors:
- background: 0xFF2F363D
- surface: 0xFF3B444C
- foreground: 0xFFE1DED8
- gray: 0xFF73736E
- primary cyan/teal: 0xFF83B9B5
- secondary blue: 0xFF8AAED0
- tertiary green with yellow/orange warmth: 0xFF9DBF9A / 0xFFD4B77A
- error red soft: 0xFFD49A96

Build check:
- Target environment: frankel cp2a user
- Modules: monet SystemUI
- Result: success, exit code 0
