#!/usr/bin/env bash
#
# Design-consistency verifier for the VidTempla dashboard.
# The goal in GOAL.md is COMPLETE only when this script exits 0.
#
# SCOPE (dashboard only): the YouTube/jobs/billing components, the dashboard
# sidebar + DashboardLayout, and the /dashboard + /org page trees.
# OUT OF SCOPE (not checked): the auth surface (AuthLayout, /auth/*, sign-in/up),
# marketing/legal pages, and the public invite page.
#
# Allowlist: append a `// design-ok` comment on any line that is a deliberate,
# reviewed exception (e.g. data-visualization colors). Document why in WORKLOG.md.
#
# Usage:  bash scripts/check-design-consistency.sh
set -uo pipefail
cd "$(dirname "$0")/../nextjs/src" || { echo "cannot cd into nextjs/src"; exit 2; }

# In-scope dashboard paths (space-separated, used as grep roots).
DASH="components/youtube components/jobs components/billing components/views \
      components/dashboard-sidebar.tsx components/layout/DashboardLayout.tsx \
      pages/dashboard pages/org"
# Adoption checks may match a primitive used ANYWHERE in the app.
ALL="components pages"

fail=0

# report NAME COMMAND [MAX_ALLOWED=0]
report() {
  local name="$1" cmd="$2" max="${3:-0}" out n
  out="$(eval "$cmd" 2>/dev/null || true)"
  n="$(printf '%s' "$out" | grep -c . || true)"
  if [ "$n" -gt "$max" ]; then
    echo "✗ $name — $n hit(s):"
    printf '%s\n' "$out" | sed 's/^/    /'
    fail=1
  else
    echo "✓ $name"
  fi
}

# present NAME COUNT MIN — fails if a primitive is dead (count < min)
present() {
  local name="$1" count="$2" min="$3"
  if [ "$count" -lt "$min" ]; then
    echo "✗ $name — primitive unused ($count importers, need >= $min)"
    fail=1
  else
    echo "✓ $name ($count importers)"
  fi
}

echo "== VidTempla dashboard consistency checks =="

# 1. Single toast system (custom useToast is the standard; sonner is banned).
#    Pattern is quote-agnostic ('.' matches either ' or ") — imports use single quotes.
report "no sonner imports" "grep -rlnE 'from .sonner.' $DASH"

# 2. Spinner primitive owns the spinner; no hand-rolled Loader2/animate-spin in scope.
report "animate-spin only via Spinner" "grep -rln 'animate-spin' $DASH"

# 3-4. Dead primitives must be ADOPTED, not deleted, to pass the greps above.
present "Spinner primitive in use"   "$(grep -rl 'ui/spinner' $ALL | wc -l | tr -d ' ')"     1
present "DataTable primitive in use" "$(grep -rl 'ui/data-table\"' $ALL | wc -l | tr -d ' ')" 1

# 5. One edit icon across the dashboard (standardize on Edit, drop Edit2).
report "no Edit2 icon (use Edit)" "grep -rln '\bEdit2\b' $DASH"

# 6. Thumbnails via next/image; no raw <img> in dashboard components.
report "no raw <img> in dashboard components" "grep -rln '<img ' components/youtube components/jobs"

# 7. Status pills go through <Badge>, not hand-rolled rounded-full color spans.
report "no hand-rolled status pills" \
  "grep -rlnE 'rounded-full[^\"]*bg-(emerald|green|amber|yellow|red)-[0-9]' $DASH"

# 8. No raw status text colors — use semantic tokens / Badge variants. `// design-ok` to allow.
report "no raw status text colors" \
  "grep -rnE 'text-(emerald|green|amber|yellow)-[0-9]{2,3}' $DASH | grep -v 'design-ok'"

# 9. One warning palette only — not amber AND yellow.
palettes="$(grep -rohE '(amber|yellow)-[0-9]' $DASH 2>/dev/null | sed -E 's/-[0-9].*//' | sort -u | grep -c . || true)"
if [ "$palettes" -gt 1 ]; then
  echo "✗ single warning palette — both amber AND yellow present"
  fail=1
else
  echo "✓ single warning palette"
fi

# 10. Page titles come from DashboardLayout's header slot, not inline h1/h2.
report "no inline text-2xl page headings" "grep -rnE '<h[12][^>]*text-2xl' pages/dashboard pages/org"

# 11. Date/time formatting centralized in lib/format (no inline toLocale* for display).
report "no inline toLocale date formatting" \
  "grep -rln 'toLocaleDateString\|toLocaleString' $DASH | grep -v 'lib/format'"

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ ALL CONSISTENCY CHECKS PASSED"
else
  echo "❌ CONSISTENCY VIOLATIONS FOUND — see ✗ lines above"
fi
exit "$fail"
