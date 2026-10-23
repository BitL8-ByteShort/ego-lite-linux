#!/bin/sh
# Install an already verified local Linux artifact. No downloads or root changes.
set -eu

if [ "${1-}" = "--help" ] || [ "${1-}" = "-h" ]; then
    printf '%s\n' 'Usage: sh install-linux.sh --artifact DIR-or-ARCHIVE [--prefix DIR] [--no-desktop]'
    printf '%s\n' 'Run from the verified extracted artifact to install an archive.'
    exit 0
fi

if [ "$(uname -s)" != Linux ]; then
    printf '%s\n' 'The Linux community build installer must run on Linux.' >&2
    exit 1
fi
command -v node >/dev/null 2>&1 || {
    printf '%s\n' 'Install Node.js 22 or later, then retry this local installer.' >&2
    exit 1
}

artifact=''
next_artifact=0
for argument in "$@"; do
    if [ "$next_artifact" -eq 1 ]; then
        artifact=$argument
        next_artifact=0
    elif [ "$argument" = '--artifact' ]; then
        next_artifact=1
    fi
done
if [ -z "$artifact" ] || [ "$next_artifact" -eq 1 ]; then
    printf '%s\n' 'Supply --artifact with a verified local artifact directory or archive.' >&2
    exit 1
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
installer=''
if [ -d "$artifact" ] && [ -f "$artifact/host/scripts/install.mjs" ]; then
    installer="$artifact/host/scripts/install.mjs"
elif [ -f "$script_dir/../../../../host/scripts/install.mjs" ]; then
    installer="$script_dir/../../../../host/scripts/install.mjs"
elif [ -f "$script_dir/../../../package/ego-linux-host/scripts/install.mjs" ]; then
    installer="$script_dir/../../../package/ego-linux-host/scripts/install.mjs"
fi
if [ -z "$installer" ]; then
    printf '%s\n' 'Extract the verified artifact and run its host/scripts/install.mjs with --artifact and --prefix.' >&2
    exit 1
fi
exec node "$installer" "$@"
