'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const configSource = fs.readFileSync(path.join(root, 'js/supabase-config.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(configSource, context, { timeout: 1000 });
const config = context.window.NOSSA_CAIXINHA_CONFIG;
if (!config || !/^https:\/\/[^/]+\.supabase\.co\/?$/.test(config.url) || !config.anonKey || /COLE_/.test(config.url + config.anonKey)) throw new Error('Configure o Supabase antes de gerar a publicação.');
let publicKey = config.anonKey.startsWith('sb_publishable_');
if (!publicKey) {
  try { publicKey = JSON.parse(Buffer.from(config.anonKey.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
}
if (!publicKey) throw new Error('A publicação exige uma chave pública publishable ou anon.');
const files = ['index.html', 'favicon.svg', 'robots.txt', 'sitemap.xml', 'social-preview.png', 'css/styles.css', 'js/app.js', 'js/render.js', 'js/finance.js', 'js/supabase-config.js'];
for (const file of files) {
  const target = path.join(root, 'dist', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
console.log('Publicação preparada em dist/ com ' + files.length + ' arquivos. Configuração usa chave pública.');
