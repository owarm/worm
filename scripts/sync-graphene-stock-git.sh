#!/usr/bin/env bash
set -u

ROOT="/opt/worm/grapheneos"
REPORT_DIR="/opt/worm/reports"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$REPORT_DIR/graphene-stock-git-$STAMP.log"

# Cambia solo questa riga se il namespace sul Git server è diverso.
GIT_WORM_BASE="git@git.worm.estixari.com:graphene-stock"

mkdir -p "$REPORT_DIR"

exec > >(tee -a "$REPORT") 2>&1

echo "=== GRAPHENEOS STOCK -> GIT.WORM ==="
echo "DATE=$(date -Is)"
echo "ROOT=$ROOT"
echo "DEST=$GIT_WORM_BASE"
echo

cd "$ROOT" || {
    echo "FAIL: Android tree missing"
    exit 1
}

echo "=== BASELINE ==="
TAG="$(git -C .repo/manifests describe --tags --exact-match 2>/dev/null || true)"
echo "TAG=$TAG"

if [ "$TAG" != "2026080500" ]; then
    echo "STOP: unexpected manifest tag: $TAG"
    exit 1
fi

test -f vendor/state/frankel.json || {
    echo "STOP: frankel state missing"
    exit 1
}

echo "DEVICE=frankel"
echo "CHANNEL=stable"
echo

echo "=== MANIFEST MIRROR ==="

MANIFEST_DEST="$GIT_WORM_BASE/platform_manifest.git"

git -C .repo/manifests push \
    "$MANIFEST_DEST" \
    '+refs/heads/*:refs/heads/*' \
    '+refs/tags/*:refs/tags/*' || {
        echo "WARN: manifest push failed"
    }

echo
echo "=== PROJECT MIRROR ==="

TOTAL=0
OK=0
FAIL=0

repo forall -c '
    path="$REPO_PATH"
    project="$REPO_PROJECT"

    # Mantiene il namespace GrapheneOS.
    dest="'"$GIT_WORM_BASE"'/${project}.git"

    printf "\n--- %s ---\n" "$project"
    echo "PATH=$path"
    echo "DEST=$dest"

    if git push "$dest" \
        "+refs/heads/*:refs/heads/*" \
        "+refs/tags/*:refs/tags/*"
    then
        echo "RESULT=OK"
    else
        echo "RESULT=FAIL"
    fi
' | tee "$REPORT_DIR/graphene-projects-$STAMP.log"

echo
echo "=== STOCK IDENTITY ==="
echo "TAG=$TAG"
echo "DEVICE=Pixel 10"
echo "CODENAME=frankel"
echo "ANDROID=17"

echo
echo "=== REPORT ==="
echo "$REPORT"
