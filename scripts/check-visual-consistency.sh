#!/usr/bin/env bash
#
# Visual-consistency verifier for the VidTempla dashboard polish branch.
# Each check is a falsifiable grep that must produce ZERO hits in its scope.
#
# Modeled on scripts/check-design-consistency.sh.
#
# Allowlist: append a `// design-ok` comment on any line that is a deliberate,
# reviewed exception. Document why in the worklog.
#
# Usage:  bash scripts/check-visual-consistency.sh
set -uo pipefail
cd "$(dirname "$0")/../nextjs/src" || { echo "cannot cd into nextjs/src"; exit 2; }

fail=0

# report NAME PATTERN SCOPE — fails if the (extended) PATTERN matches anywhere in SCOPE.
report() {
  local name="$1" pattern="$2" scope="$3" out n
  out="$(grep -rnE "$pattern" $scope 2>/dev/null | grep -v 'design-ok' || true)"
  n="$(printf '%s' "$out" | grep -c . || true)"
  if [ "$n" -gt 0 ]; then
    echo "✗ $name — $n hit(s):"
    printf '%s\n' "$out" | sed 's/^/    /'
    fail=1
  else
    echo "✓ $name"
  fi
}

echo "== VidTempla dashboard visual-consistency checks =="

report "card-title-default-or-oversized" \
  '<CardTitle>|<CardTitle[^>]*text-(xl|2xl|3xl)' \
  "components/youtube components/jobs components/billing components/views pages/dashboard pages/org pages/admin"

report "overlay-title-oversized" \
  '(SheetTitle|DialogTitle|AlertDialogTitle)[^>]*text-(xl|2xl|3xl)' \
  "components/youtube components/jobs components/billing components/views pages"

report "arbitrary-spacing-value" \
  '(^|["'"'"' ])(p|px|py|pt|pb|pl|pr|m|mt|mb|ml|mr|mx|my|gap|gap-x|gap-y|space-x|space-y)-\[' \
  "components/youtube components/jobs components/billing components/views components/layout/DashboardLayout.tsx components/dashboard-sidebar.tsx pages/dashboard pages/org pages/admin"

report "page-stack-grid-gap6-misuse" \
  'className="grid gap-6"' \
  "components/views pages/dashboard pages/org pages/admin"

report "page-stack-space-y-8" \
  'space-y-8' \
  "components/views pages/dashboard pages/org pages/admin"

report "redeclared-page-container" \
  'container mx-auto|max-w-7xl|max-w-screen' \
  "components/youtube components/jobs components/billing components/views pages/dashboard pages/org pages/admin"

report "raw-status-palette-color" \
  '(text|bg|border|ring)-(red|green|amber|yellow|orange|emerald|lime)-[0-9]' \
  "components/youtube components/jobs components/billing components/views pages/dashboard pages/org pages/admin"

report "nested-panel-rounded-md-border" \
  'rounded-md border' \
  "components/youtube components/jobs components/billing components/views pages/dashboard pages/org pages/admin"

report "side-sheet-width-3xl" \
  'SheetContent[^>]*max-w-3xl' \
  "components/youtube components/jobs components/billing components/views"

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ ALL VISUAL-CONSISTENCY CHECKS PASSED"
else
  echo "❌ VISUAL-CONSISTENCY VIOLATIONS FOUND — see ✗ lines above"
fi
exit "$fail"
