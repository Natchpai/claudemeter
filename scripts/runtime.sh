# Shared interpreter lookup for claudemeter's scripts.
# Claude Code spawns hooks and the status line through a shell that inherits its
# own environment, so PATH is usually the user's — but a login-shell-only nvm
# setup can leave it out, hence the explicit probes.
claudemeter_runtime() {
  if command -v node >/dev/null 2>&1; then echo node; return 0; fi
  if command -v bun >/dev/null 2>&1; then echo bun; return 0; fi
  for candidate in \
    /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node \
    "$HOME/.local/bin/node" "$HOME/.bun/bin/bun"; do
    [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  done
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
    [ -x "$candidate" ] && echo "$candidate"
  done | sort -V | tail -n 1 | grep . && return 0
  return 1
}
