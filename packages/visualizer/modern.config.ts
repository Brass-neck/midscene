import path from 'node:path';
import { defineConfig, moduleTools } from '@modern-js/module-tools';
import { modulePluginNodePolyfill } from '@modern-js/plugin-module-node-polyfill';
import { version } from './package.json';
const externals = ['playwright', 'bufferutil', 'utf-8-validate'];


const commonConfig = {
  asset: {
    svgr: true,
  },
  autoExternal: false,
  externals: [...externals],
  target: 'es2018',
  minify: process.env.CI
    ? {
        compress: true,
      }
    : undefined,
  define: {
    __VERSION__: version,
  },
};

export default defineConfig({
  buildConfig: [
    {
      ...commonConfig,
      alias: {
        async_hooks: path.join(__dirname, './src/blank_polyfill.ts'),
      },
      format: 'umd',
      dts: false,
      input: {
        index: 'src/index.tsx',
      },
      umdModuleName: (path) => {
        return 'midsceneVisualizer';
      },
      platform: 'browser',
      outDir: 'dist',
      target: 'es2018',
      sourceMap: true,
    },
    {
      ...commonConfig,
      alias: {
        async_hooks: path.join(__dirname, './src/blank_polyfill.ts'),
      },
      format: 'iife',
      dts: false,
      input: {
        'water-flow': 'src/extension/scripts/water-flow.ts',
        'stop-water-flow': 'src/extension/scripts/stop-water-flow.ts',
        popup: 'src/extension/popup.tsx',
        worker: 'src/extension/worker.ts',
        'playground-entry': 'src/extension/playground-entry.tsx',
        'browser-polyfill': 'src/extension/fortress/browser-polyfill.js',
        content: 'src/extension/fortress/content.js',
      },
      platform: 'browser',
      outDir: '/Users/bytedance/Desktop/fortress/lib',
      //todo zz 调试完修改
      // outDir: 'unpacked-extension/lib',
      target: 'es2018',
      externals: [...externals],
    },
  ],
  plugins: [
    moduleTools(),
    modulePluginNodePolyfill({
      excludes: ['console'],
    }),
  ],
  buildPreset: 'npm-component',
});
