import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 1ファイルにまとめる（スマホのブラウザ確認用。Capacitor でもそのまま使える）
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
});
