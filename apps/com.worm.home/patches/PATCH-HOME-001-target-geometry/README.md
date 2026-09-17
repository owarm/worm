# PATCH-001 — target geometry + target colors

Questa è la prima patch della nuova serie pulita.

Riferimento obbligatorio:

`/opt/com.worm/reference/home-target.png`

## Obiettivo

PATCH-001 modifica SOLO la struttura Home e i colori/surface principali.

Non sostituisce ancora il renderer delle icone: quello sarà PATCH-002.

## Geometria misurata da home-target.png

Reference canvas:

`691 x 1536`

Main outer:
- x = 67
- y = 639
- w = 557
- h = 713

Fav. apps:
- x = 86
- y = 663
- w = 519
- h = 125

Grid 1:
- x = 87
- y = 807
- w = 518
- h = 250

Grid 2:
- x = 87
- y = 1076
- w = 518
- h = 250

Dock:
- x = 68
- y = 1378
- w = 555
- h = 132

Il layout usa una scala uniforme basata sulla larghezza del display.

L'altezza extra rimane wallpaper: non ingrandisce verticalmente la UI.

## Colori target

- outer: `#151515`
- app panels: `#232323`
- dock: `#151515`
- Fav. apps: `#5F676A`
- primary text: `#F8F8F8`
- secondary text: `#EBEBEB`

## Applica

```bash
cd /opt/com.worm/patches
unzip PATCH-HOME-001-target-geometry.zip
cd PATCH-HOME-001-target-geometry
chmod +x apply.sh
./apply.sh
```

Timezone backup/log:

`TZ=Europe/Rome`
