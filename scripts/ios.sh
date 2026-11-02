#!/bin/sh
# Run Tauri iOS commands without requiring `sudo xcode-select`.
# If Xcode is installed but xcode-select still points at CommandLineTools,
# this creates a tiny PATH shim that points Xcode's tools at the real SDK.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEVELOPER="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

if [ ! -x "$DEVELOPER/usr/bin/xcodebuild" ]; then
  echo "Xcode was not found at $DEVELOPER." >&2
  echo "Install Xcode 15+ or set DEVELOPER_DIR to your Xcode Developer directory." >&2
  exit 1
fi

SHIM="$ROOT/src-tauri/target/ios-shim"
mkdir -p "$SHIM"

cat > "$SHIM/xcodebuild" <<EOF
#!/bin/sh
export DEVELOPER_DIR="$DEVELOPER"
exec "$DEVELOPER/usr/bin/xcodebuild" "\$@"
EOF

cat > "$SHIM/xcrun" <<EOF
#!/bin/sh
export DEVELOPER_DIR="$DEVELOPER"
exec /usr/bin/xcrun "\$@"
EOF

cat > "$SHIM/xcode-select" <<EOF
#!/bin/sh
case "\$1" in
  -p|--print-path) echo "$DEVELOPER" ;;
  *) exec /usr/bin/xcode-select "\$@" ;;
esac
EOF

chmod +x "$SHIM/xcodebuild" "$SHIM/xcrun" "$SHIM/xcode-select"
export DEVELOPER_DIR="$DEVELOPER"
export PATH="$SHIM:$PATH"

cd "$ROOT"

# CocoaPods state is regenerable and removed by scripts/clean.sh.
if [ -f "$ROOT/src-tauri/gen/apple/Podfile" ] && [ ! -d "$ROOT/src-tauri/gen/apple/Pods" ]; then
  if command -v pod >/dev/null 2>&1; then
    (cd "$ROOT/src-tauri/gen/apple" && pod install)
  else
    echo "CocoaPods is required for iOS builds: brew install cocoapods" >&2
    exit 1
  fi
fi

exec npx tauri ios "$@"
