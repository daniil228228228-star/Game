#!/bin/sh
# regenerates docs/PLAN_C_REAL_WORLD_AUDIT.md = docs/parts/rw-head.md + docs/parts/rw-part3.md + the generated table
cd "$(dirname "$0")/../.." && { cat docs/parts/rw-head.md docs/parts/rw-part3.md; node tools/masterplan/audit-plan-c.mjs --rw --md | grep '^| '; } > docs/PLAN_C_REAL_WORLD_AUDIT.md
