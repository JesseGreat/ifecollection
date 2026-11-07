#!/usr/bin/env bash
# Download Supabase Auth (GoTrue) and PostgREST binaries for the local end-to-end stack (Linux x86-64).
set -euo pipefail
cd "$(dirname "$0")/../.."
AUTH_VERSION="${AUTH_VERSION:-v2.197.0}"
PGRST_VERSION="${PGRST_VERSION:-v16.5}"
mkdir -p .e2e/bin && cd .e2e/bin
if [ ! -x auth ]; then
  curl -fsSL "https://github.com/supabase/auth/releases/download/${AUTH_VERSION}/auth-${AUTH_VERSION}-x86.tar.gz" | tar -xz
fi
if [ ! -x postgrest ]; then
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/${PGRST_VERSION}/postgrest-${PGRST_VERSION}-linux-static-x86-64.tar.xz" | tar -xJ
fi
echo "Binaries ready in .e2e/bin"
