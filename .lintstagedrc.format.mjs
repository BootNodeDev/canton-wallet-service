// The writing half of the pre-commit, kept apart so the read-only gates in .lintstagedrc.mjs can
// run concurrently behind it. See .husky/pre-commit.
export default {
  '{src,test,scripts}/**/*.{ts,js,mjs,json,jsonc}': 'biome check --write --no-errors-on-unmatched',
  '*.{ts,js,mjs,json,jsonc}': 'biome check --write --no-errors-on-unmatched',
}
