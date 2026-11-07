#!/usr/bin/env bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mode=${1:-demo}
if (($#)); then shift; fi
case "$mode" in
  demo)
    # Keep discovered presentation extensions, including pi-omp-theme.
    exec pi --offline --no-session -e "$here/index.ts" --tui-mode fullscreen "$@"
    ;;
  test-provider|test-provider-large)
    model=local
    if [[ $mode == test-provider-large ]]; then model=local-large; fi
    exec pi --offline -ne --no-mcp -ns -np -nc --no-session \
      -e "$here/index.ts" -e "$here/test-provider.ts" \
      --provider questionnaire-test --model "$model" --thinking off \
      --tools questionnaire --tui-mode fullscreen "$@" 'test questionnaire'
    ;;
  *) printf 'Usage: bash %s {demo|test-provider|test-provider-large} [pi options]\n' "$0" >&2; exit 2 ;;
esac
