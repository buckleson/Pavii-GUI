/**
 * Anti-slop audit configuration (dmmulroy/anti-slop, vendored under
 * `tools/oxlint/anti-slop/`).
 *
 * Deliberately SEPARATE from `.oxlintrc.json`, which is the gate `just push`
 * and CI run. Two reasons:
 *
 *  - oxlint only reads JS/TS config files when it runs under Node, and this
 *    repo lints through Bun. Folding these rules into the main config would
 *    mean changing how the gate is invoked.
 *  - these rules are opinionated and report against long-standing code. Making
 *    them blocking on day one would wedge every push behind a backlog.
 *
 * Run it with `bun run lint:anti-slop`.
 *
 * The rules reject low-evidence patterns: values widened to `unknown`/`object`
 * and re-asserted, ad hoc `typeof` checks standing in for parsing at a
 * boundary, type assertions with no stated reason.
 */
export default {
  ignorePatterns: [
    '**/node_modules/**',
    'out/**',
    'dist/**',
    'dist-server/**',
    'dist-web-cli/**',
    'coverage/**',
    'the-remaa/**',
    // The plugin would otherwise lint its own source.
    'tools/oxlint/anti-slop/**',
    '.cache/**',
    'mobile/**',
  ],
  // Resolved relative to this config file, not the working directory.
  jsPlugins: [{ name: 'anti-slop', specifier: './anti-slop/index.ts' }],
  rules: {
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-conditional-empty-object-spread': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-runtime-typeof': 'error',
    'anti-slop/no-shape-in-symbol-names': 'error',
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unknown-returns': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'error',
    // `no-module-mocking` is left off: this suite mocks modules deliberately
    // (electron, node:fs, the IPC bridge) because the alternative is booting
    // Electron in a unit test. Enabling it would report most of tests/unit
    // without describing a defect.
  },
};
