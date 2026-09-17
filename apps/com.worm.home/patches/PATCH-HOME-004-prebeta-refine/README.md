# PATCH-HOME-004 — pre-beta refine

Riferimento:

`/opt/worm/apps/com.worm.home/reference/home-target.png`

Questa patch rifinisce ciò che abbiamo definito in chat senza cambiare la struttura.

## 1. Gap / display

Mantiene la logica di PATCH-003:

- dock ancorata sopra la navigation bar
- gap dock → navigation bar derivato dal target
- gap main container → dock derivato dal target
- extra altezza display = wallpaper

In più evita rebuild ripetuti quando dimensioni/inset non sono cambiati.

## 2. P1 e P2

Mantiene:
- ombra sottile
- linea 1dp a bassa opacità
- radius target

Rifinisce outline e shadow per essere meno marcati.

## 3. Dock

- stessa geometria target
- ombra leggermente più morbida rispetto a P1/P2
- resta separata dal main container
- mantiene il gap dalla navigation bar

## 4. Renderer icone

Nuovo `WormIconRenderer`:

- AdaptiveIconDrawable: preserva background e foreground reali
- rounded-square, non circolare
- niente grande tile bianca forzata
- overscan moderato per dimensione ottica più vicina al target
- legacy icons con backing neutro scuro
- cache LRU semplice per evitare rendering ripetuto

## 5. Stabilità pre-beta

- conserva ComponentName per il lancio
- contentDescription sulle icone
- build pulita `clean assembleRelease`
- nessun Settings
- nessun clock
- nessun wallpaper preimpostato
- `TZ=Europe/Rome`

## Applica

```bash
cd /opt/worm/apps/com.worm.home/patches
unzip PATCH-HOME-004-prebeta-refine.zip
cd PATCH-HOME-004-prebeta-refine
chmod +x apply.sh
./apply.sh
```
