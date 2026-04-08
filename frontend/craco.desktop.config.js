/**
 * CRACO config for the Cthulhu Desktop build.
 *
 * Used ONLY by the desktop build script:
 *   craco build --config craco.desktop.config.js
 *
 * Differences from the web app's craco.config.js:
 *   - Entry point is desktop-index.js instead of index.js
 *   - REACT_APP_BACKEND_URL defaults to http://localhost:8001 (local sidecar)
 *   - No Emergent visual-edits plugin
 *   - No health check plugin
 *
 * The web app's craco.config.js is NEVER touched.
 */

const path = require("path");

module.exports = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {
      const webpack = require('webpack');

      // ── Override entry point to desktop-index.js ──────────────────────
      // CRA sets entry as an array. We replace it entirely.
      webpackConfig.entry = path.resolve(__dirname, 'src/desktop-index.js');

      // ── Polyfills (same as web app) ──────────────────────────────────
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        buffer: require.resolve('buffer/'),
        stream: false,
        crypto: false,
      };

      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        'uint8array-tools': path.resolve(__dirname, 'node_modules/bitcoinjs-lib/node_modules/uint8array-tools/src/mjs/browser.js'),
      };

      webpackConfig.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
        })
      );

      // ── Default REACT_APP_BACKEND_URL for desktop ────────────────────
      // Points to the local PyInstaller sidecar running on :8001
      webpackConfig.plugins.push(
        new webpack.DefinePlugin({
          'process.env.REACT_APP_BACKEND_URL': JSON.stringify(
            process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001'
          ),
        })
      );

      // Exclude @noble packages from source-map-loader
      const smLoader = webpackConfig.module.rules.find(r =>
        r.enforce === 'pre' && r.use && r.use.some && r.use.some(u => u.loader && u.loader.includes('source-map-loader'))
      );
      if (smLoader) {
        smLoader.exclude = [/node_modules\/@noble/];
      }

      return webpackConfig;
    },
  },
};
