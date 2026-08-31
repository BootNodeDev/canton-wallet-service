// Read-only gates only. The formatter runs first, from .lintstagedrc.format.mjs, so these are safe
// to run concurrently with each other.
export default {
  // One task for the whole suite, under the name CI uses: the tests import across src/ freely, so
  // a per-file run would only be a slower way of reaching the same verdict.
  '{src,test}/**/*.ts': () => 'pnpm test',
}
