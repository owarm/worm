worm-os-rendered-icons-v001

System-level Worm OS icon rendering patch.

Changes:
- Replaces the framework adaptive icon mask with the Worm rounded-soft mask.
- Adds Worm as the default Launcher3 icon shape option when launcher icon shapes are enabled.
- Keeps themed/monochrome rendering on existing Launcher3 Dynamic Color path.

Build:
- Target: frankel cp2a user
- Command: m -j8 framework-res Launcher3QuickStep
- Result: SUCCESS

Safety notes:
- No status bar glyphs, accessibility icons, notification small icons, security indicators, or warning/error icons were modified.
- No third-party icon assets were copied.
