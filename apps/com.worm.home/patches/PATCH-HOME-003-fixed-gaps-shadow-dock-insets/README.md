# PATCH-HOME-003 — fixed display gaps + P1/P2 shadow + dock/nav gap

Reference obbligatoria:

`/opt/worm/apps/com.worm.home/reference/home-target.png`

## Cosa fa

- tenta di **tenere più fermi i gap** sul display
- ancora la **dock sopra la navigation bar** usando lo stesso gap target
- ricava il container principale dalla dock, mantenendo il gap `outer -> dock`
- aggiunge a **P1** e **P2**:
  - ombra più visibile
  - linea/stroke sottile con opacità
- mantiene solo il **wallpaper di sistema**

## Gaps target

- outer -> dock = 26 px reference
- dock -> bottom / nav area = 26 px reference

La dock usa:

`bottomMargin = navigationBarInset + scaledGap`

Il container principale usa:

`bottomMargin = dockBottom + dockHeight + scaledOuterDockGap`

## Apply

```bash
cd /opt/worm/apps/com.worm.home/patches
unzip PATCH-HOME-003-fixed-gaps-shadow-dock-insets.zip
cd PATCH-HOME-003-fixed-gaps-shadow-dock-insets
chmod +x apply.sh
./apply.sh
```

Timezone backup/log: `Europe/Rome`
