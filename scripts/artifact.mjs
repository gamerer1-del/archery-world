// dist/index.html から <title>/<style>/<script> を取り出し、Artifact 公開用の artifact.html を作る
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync('artifact.html', head.trim() + '\n' + body.trim() + '\n');
console.log('artifact.html', (head.length + body.length) / 1024 | 0, 'KB');
