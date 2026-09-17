#!/usr/bin/env bash
set -euo pipefail

PROJECT="/opt/worm/apps/com.worm.ai"
PATCH="/opt/worm/patches/worm-ai-v001"

ok() { printf '[OK] %s\n' "$*"; }
info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
error() { printf '[ERROR] %s\n' "$*" >&2; }

required_files=(
  "$PROJECT/settings.gradle.kts"
  "$PROJECT/build.gradle.kts"
  "$PROJECT/gradle.properties"
  "$PROJECT/gradlew"
  "$PROJECT/gradlew.bat"
  "$PROJECT/gradle/wrapper/gradle-wrapper.jar"
  "$PROJECT/gradle/wrapper/gradle-wrapper.properties"
  "$PROJECT/app/build.gradle.kts"
  "$PROJECT/app/src/main/AndroidManifest.xml"
  "$PROJECT/app/src/main/java/com/worm/ai/MainActivity.kt"
  "$PROJECT/app/src/main/java/com/worm/ai/ui/theme/Theme.kt"
  "$PROJECT/app/src/main/res/values/strings.xml"
  "$PROJECT/app/src/main/res/values/themes.xml"
  "$PROJECT/README.md"
)

info "Project: $PROJECT"
info "Patch: $PATCH"

if [[ ! -d "$PROJECT" ]]; then
  error "Project path is missing: $PROJECT"
  exit 1
fi

if [[ ! -d "$PATCH" ]]; then
  error "Patch path is missing: $PATCH"
  exit 1
fi

for file in "${required_files[@]}"; do
  if [[ -e "$file" ]]; then
    ok "found $file"
  else
    error "missing $file"
    exit 1
  fi
done

chmod +x "$PROJECT/gradlew" "$PATCH/apply.sh" "$PATCH/build.sh" "$PATCH/install.sh" "$PATCH/uninstall.sh" "$PATCH/debug.sh"
ok "minimal Worm AI project files verified"
info "No GrapheneOS, MachinaLLM, TermLLM, WebUSB, storage-box, or remote git changes performed"
