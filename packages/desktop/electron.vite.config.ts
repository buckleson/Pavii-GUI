import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import UnoCSS from 'unocss/vite';
import unoConfig from '../../uno.config.ts';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Read the real AionUi version from the repo-root package.json.
// `packages/desktop/package.json` is a workspace-internal placeholder pinned
// at "0.0.0" — never use it for user-visible version strings.
const rootPackageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  version: string;
};

// Build builtin MCP servers after main process bundle so they survive out/main/ cleanup.
function buildMcpServersPlugin() {
  return {
    name: 'vite-plugin-build-mcp-servers',
    closeBundle() {
      execSync(`node "${resolve('scripts/build-mcp-servers.js')}"`, { stdio: 'inherit' });
    },
  };
}

// Icon Park transform plugin (replaces webpack icon-park-loader)
function iconParkPlugin() {
  return {
    name: 'vite-plugin-icon-park',
    enforce: 'pre' as const,
    transform(source: string, id: string) {
      if (!id.endsWith('.tsx') || id.includes('node_modules')) return null;
      if (!source.includes('@icon-park/react')) return null;
      const transformedSource = source.replace(
        /import\s+\{\s+([a-zA-Z, ]*)\s+\}\s+from\s+['"]@icon-park\/react['"](;?)/g,
        function (str, match) {
          if (!match) return str;
          const components = match.split(',');
          const importComponent = str.replace(
            match,
            components.map((key: string) => `${key} as _${key.trim()}`).join(', ')
          );
          const hoc = `import IconParkHOC from '@renderer/components/IconParkHOC';
          ${components.map((key: string) => `const ${key.trim()} = IconParkHOC(_${key.trim()})`).join(';\n')}`;
          return importComponent + ';' + hoc;
        }
      );
      if (transformedSource !== source) return { code: transformedSource, map: null } as { code: string; map: null };
      return null;
    },
  };
}

// Common path aliases for main process and workers
const desktopSrcRoot = resolve('packages/desktop/src');
const rendererRoot = resolve('packages/desktop/src/renderer');

const mainAliases = {
  '@': desktopSrcRoot,
  '@common': resolve('packages/desktop/src/common'),
  '@renderer': rendererRoot,
  '@process': resolve('packages/desktop/src/process'),
  '@worker': resolve('packages/desktop/src/process/worker'),
  '@xterm/headless': resolve('packages/desktop/src/common/utils/shims/xterm-headless.ts'),
};

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  const enableSentrySourceMaps =
    !isDevelopment &&
    !!process.env.SENTRY_AUTH_TOKEN &&
    (process.env.CI !== 'true' || process.env.SENTRY_UPLOAD_SOURCE_MAPS === 'true');
  const sentryReleaseName = process.env.SENTRY_RELEASE ?? `v${rootPackageJson.version}`;

  const sentryPluginOptions = {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: {
      name: sentryReleaseName,
    },
    errorHandler: (error: Error) => {
      throw error;
    },
    sourcemaps: {
      filesToDeleteAfterUpload: ['./out/**/*.map'],
      rewriteSources: (source: string) => {
        // Normalize Windows backslashes and strip leading relative prefixes
        // so Sentry paths match the GitHub repo structure (e.g.
        // packages/desktop/src/process/...)
        return source.replace(/\\/g, '/').replace(/^(\.\.\/)+(packages\/desktop\/src\/)/, '$2');
      },
    },
  };

  return {
    main: {
      plugins: [
        // externalizeDepsPlugin replaces our custom getExternalDeps() + pluginExternalizeDynamicImports.
        // 'fix-path' excluded so it gets bundled inline (only 3KB).
        // '@pavii/web-host' excluded so its TS sources (which use ESM ".js" import specifiers)
        // are bundled by esbuild rather than left as `require('@pavii/web-host')`, which Node
        // cannot resolve because the package ships no compiled .js files (workspace-only).
        externalizeDepsPlugin({ exclude: ['fix-path', '@pavii/web-host'] }),
        ...(isDevelopment
          ? [
              {
                name: 'dev-build-mcp-servers',
                closeBundle() {
                  execSync(`node "${resolve(__dirname, '../../scripts/build-mcp-servers.js')}"`, {
                    stdio: 'inherit',
                  });
                },
              },
            ]
          : []),
        ...(!isDevelopment
          ? [
              viteStaticCopy({
                structured: false,
                // electron-vite builds main process as SSR; viteStaticCopy defaults
                // to environment: "client" and silently skips non-client environments.
                environment: 'ssr',
                targets: [
                  // Use single * glob to copy top-level items (directories) with their contents intact.
                  // Using ** would flatten all nested files into the dest root.
                  { src: 'packages/desktop/src/renderer/assets/logos/*', dest: 'static/images' },
                ],
              }),
            ]
          : []),
        ...(enableSentrySourceMaps ? [sentryVitePlugin(sentryPluginOptions)] : []),
        ...(isDevelopment ? [buildMcpServersPlugin()] : []),
      ],
      resolve: { alias: mainAliases, extensions: ['.ts', '.tsx', '.js', '.json'] },
      build: {
        sourcemap: enableSentrySourceMaps ? 'hidden' : isDevelopment,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('packages/desktop/src/index.ts'),
            // Built-in MCP server entry points (compiled by scripts/build-mcp-servers.js via esbuild,
            // not vite — esbuild bundles all deps for self-contained execution by external node processes)
          },
          onwarn(warning, warn) {
            if (warning.code === 'EVAL') return;
            warn(warning);
          },
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.env': JSON.stringify(process.env.env),
        'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? ''),
        // PostHog analytics — see the renderer define block below.
        'process.env.POSTHOG_KEY': JSON.stringify(process.env.POSTHOG_KEY ?? ''),
        'process.env.POSTHOG_DISABLED': JSON.stringify(process.env.POSTHOG_DISABLED ?? ''),
        // Discontinued-build fork flag (see discontinuedBuild.ts). Only AionUi's
        // final `-final` tag build sets IS_DISCONTINUED_BUILD=true in CI.
        'process.env.IS_DISCONTINUED_BUILD': JSON.stringify(process.env.IS_DISCONTINUED_BUILD === 'true'),
      },
    },

    preload: {
      // Bundle @sentry/electron/preload so its hookupIpc() runs in the preload
      // context. Externalized dependencies leave a runtime require('...') in
      // the output, which Electron's sandbox-mode preload cannot resolve from
      // node_modules (→ "module not found"). Bundling inlines the few hundred
      // bytes of IPC wiring we actually need.
      plugins: [externalizeDepsPlugin({ exclude: ['@sentry/electron'] })],
      resolve: {
        alias: {
          '@': resolve('packages/desktop/src'),
          '@common': resolve('packages/desktop/src/common'),
        },
        extensions: ['.ts', '.tsx', '.js', '.json'],
      },
      build: {
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('packages/desktop/src/preload/main.ts'),
          },
        },
      },
    },

    renderer: {
      // The renderer workspace moved under packages/desktop/src/renderer in M1.
      // Make the root explicit so Vite emits page names relative to that directory
      // instead of leaking source-relative ../../ paths into HTML asset names.
      root: rendererRoot,
      base: './',
      publicDir: resolve('public'),
      appType: 'mpa',
      server: {
        // Default to 5173; when occupied (e.g. another AionUi clone is running),
        // Vite auto-increments to the next available port.
        // electron-vite reads the actual port and sets ELECTRON_RENDERER_URL accordingly.
        port: 5173,
        // Explicit HMR host so Vite client connects directly to the Vite dev server,
        // not to the WebUI proxy server (which would reject the WebSocket and cause infinite reload).
        // Port is omitted so it automatically matches the server port.
        hmr: {
          host: 'localhost',
        },
      },
      resolve: {
        alias: {
          '@': resolve('packages/desktop/src'),
          '@common': resolve('packages/desktop/src/common'),
          '@renderer': resolve('packages/desktop/src/renderer'),
          '@process': resolve('packages/desktop/src/process'),
          '@worker': resolve('packages/desktop/src/process/worker'),
          // Force ESM version of streamdown
          streamdown: resolve('node_modules/streamdown/dist/index.js'),
        },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
        // CodeMirror relies on module-level singletons (highlighterFacet, tag
        // sets). If Vite pre-bundles two copies of @codemirror/language (one for
        // our direct import, one nested under @uiw/react-codemirror), our custom
        // markdown HighlightStyle registers on a facet the editor never reads,
        // so the source view silently falls back to near-monochrome. Dedupe the
        // singleton packages to a single physical copy. Only packages hoisted to
        // the top-level node_modules may be deduped here — @lezer/common is not
        // hoisted under bun's isolated layout, so listing it breaks the Rollup
        // production build (cannot resolve from nested @codemirror/lang-* dirs).
        dedupe: [
          'react',
          'react-dom',
          'react-router-dom',
          '@codemirror/state',
          '@codemirror/view',
          '@codemirror/language',
          '@lezer/highlight',
        ],
      },
      plugins: [
        UnoCSS(unoConfig),
        iconParkPlugin(),
        ...(enableSentrySourceMaps ? [sentryVitePlugin(sentryPluginOptions)] : []),
      ],
      build: {
        target: 'es2022',
        sourcemap: enableSentrySourceMaps ? 'hidden' : isDevelopment,
        minify: !isDevelopment,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 1500,
        cssCodeSplit: true,
        rollupOptions: {
          input: {
            index: resolve(rendererRoot, 'index.html'),
          },
          external: ['node:crypto', 'crypto'],
          onwarn(warning, warn) {
            if (warning.code === 'EVAL') return;
            warn(warning);
          },
          output: {
            manualChunks(id: string) {
              // Shared interop/babel helpers must live in the root vendor chunk;
              // letting Rollup hoist them into an arbitrary vendor chunk creates
              // circular chunk imports (react -> editor -> highlight -> arco -> react)
              // that leave React uninitialized when vendor-arco evaluates (blank page).
              if (id.includes('commonjsHelpers')) return 'vendor-react';
              if (!id.includes('node_modules')) return undefined;
              if (id.includes('/@babel/runtime/')) return 'vendor-react';
              if (id.includes('/scheduler/')) return 'vendor-react';
              // Exact-package match: '/react/' as a substring also matches
              // @iconify/react and @monaco-editor/react, which import editor/icon
              // code and would drag foreign dependencies into the react chunk.
              if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) return 'vendor-react';
              if (id.includes('/@arco-design/')) return 'vendor-arco';
              if (
                id.includes('/react-markdown/') ||
                id.includes('/remark-') ||
                id.includes('/rehype-') ||
                id.includes('/unified/') ||
                id.includes('/mdast-') ||
                id.includes('/hast-') ||
                id.includes('/micromark')
              )
                return 'vendor-markdown';
              if (
                id.includes('/react-syntax-highlighter/') ||
                id.includes('/refractor/') ||
                id.includes('/highlight.js/')
              )
                return 'vendor-highlight';
              if (
                id.includes('/monaco-editor/') ||
                id.includes('/@monaco-editor/') ||
                id.includes('/codemirror/') ||
                id.includes('/@codemirror/')
              )
                return 'vendor-editor';
              if (id.includes('/katex/')) return 'vendor-katex';
              if (id.includes('/@icon-park/')) return 'vendor-icons';
              if (id.includes('/diff2html/')) return 'vendor-diff';
              if (id.includes('/posthog-js/') || id.includes('/@posthog/')) return 'vendor-posthog';
              return undefined;
            },
          },
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.env': JSON.stringify(process.env.env),
        'process.env.AIONUI_MULTI_INSTANCE': JSON.stringify(process.env.AIONUI_MULTI_INSTANCE ?? ''),
        'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? ''),
        // PostHog analytics. The project key is a public write-only token and
        // lives in common/analytics/config.ts; these only override or disable it.
        'process.env.POSTHOG_KEY': JSON.stringify(process.env.POSTHOG_KEY ?? ''),
        'process.env.POSTHOG_DISABLED': JSON.stringify(process.env.POSTHOG_DISABLED ?? ''),
        // Inject the real AionUi version (root package.json) so renderer code
        // can show it without importing packages/desktop/package.json, which is
        // a workspace-internal placeholder frozen at "0.0.0".
        __APP_VERSION__: JSON.stringify(rootPackageJson.version),
        // Renderer-side discontinued-build flag; consumed via discontinuedBuild.ts.
        __IS_DISCONTINUED_BUILD__: JSON.stringify(process.env.IS_DISCONTINUED_BUILD === 'true'),
        global: 'globalThis',
      },
      optimizeDeps: {
        exclude: ['electron'],
        include: [
          'react',
          'react-dom',
          'react-router-dom',
          'react-i18next',
          'i18next',
          '@arco-design/web-react',
          '@icon-park/react',
          'react-markdown',
          'react-syntax-highlighter',
          'react-virtuoso',
          'classnames',
          'swr',
          'eventemitter3',
          'posthog-js',
          'katex',
          'diff2html',
          'remark-gfm',
          'remark-math',
          'remark-breaks',
          'rehype-raw',
          'rehype-katex',
          // Pre-bundle the CodeMirror entry points together so they share a
          // single @codemirror/language copy (see dedupe note above); otherwise
          // the markdown source view loses its custom syntax highlighting.
          '@uiw/react-codemirror',
          '@codemirror/lang-markdown',
          '@codemirror/language',
        ],
      },
    },
  };
});
