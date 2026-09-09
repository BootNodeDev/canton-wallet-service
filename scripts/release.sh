#!/usr/bin/env bash
# Opens a release: bumps package.json on a fresh branch off main and commits it,
# so the bump goes through a pull request like any other change. Merging that
# pull request is what publishes (see .github/workflows/release.yml); nothing
# here pushes.
set -euo pipefail

bump="${1:-}"
case "$bump" in
  patch | minor | major) ;;
  *)
    echo "usage: pnpm release <patch|minor|major>" >&2
    exit 2
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "release: the working tree is not clean; commit or stash first" >&2
  exit 1
fi

branch=$(git symbolic-ref -q --short HEAD || true)
if [ "$branch" != "main" ]; then
  echo "release: start from main (currently on '${branch:-a detached HEAD}')" >&2
  exit 1
fi

# The bump must sit on exactly what origin has, or the pull request drags
# unrelated local commits along with it.
git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "release: local main differs from origin/main; pull first" >&2
  exit 1
fi

pnpm version "$bump" --no-git-tag-version
version=$(node -p "require('./package.json').version")

git switch -c "release/$version"
git add package.json
git commit -m "chore: release $version"

cat <<MSG

release/$version is ready. Next:
  git push -u origin release/$version
then open the pull request; merging it publishes $version.
MSG
