# PATCH-HOME-002 — original gaps + system wallpaper

Reference obbligatoria:

`/opt/worm/apps/com.worm.home/reference/home-target.png`

Gap originali del target (canvas 691×1536):

- outer top → Fav. apps: **24 px**
- Fav. apps → grid 1: **19 px**
- grid 1 → grid 2: **19 px**
- grid 2 → outer bottom: **26 px**
- outer → dock: **26 px**
- dock → bottom: **26 px**

I valori vengono scalati uniformemente dalla larghezza del display.
L'altezza extra resta wallpaper.

## Wallpaper

Nessun wallpaper è incluso o impostato da WORM Home.

La Home usa esclusivamente il wallpaper di sistema del telefono tramite:

`android:windowShowWallpaper=true`

## Apply

```bash
cd /opt/worm/apps/com.worm.home/patches
unzip PATCH-HOME-002-target-gaps-system-wallpaper.zip
cd PATCH-HOME-002-target-gaps-system-wallpaper
chmod +x apply.sh
./apply.sh
```

Timezone log/backup: `Europe/Rome`
