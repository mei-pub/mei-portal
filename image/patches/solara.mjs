// solara patch —— index.html favicon 绝对路径修正
// API 路径(/api/ /proxy /palette)由 nginx sub_filter 重写（类似 mei-link）
import fs from 'fs';

const indexHtml = 'index.html';
if (fs.existsSync(indexHtml)) {
  let h = fs.readFileSync(indexHtml, 'utf8');
  // /favicon.svg → music/favicon.svg（相对路径也可，但统一加前缀稳妥）
  h = h.replace(/(href|src)="\/(favicon)/g, '$1="/music/$2');
  fs.writeFileSync(indexHtml, h);
  console.log('[patch] solara: index.html favicon 路径修正');
}

// login.html 同样处理
const loginHtml = 'login.html';
if (fs.existsSync(loginHtml)) {
  let h = fs.readFileSync(loginHtml, 'utf8');
  h = h.replace(/(href|src)="\/(favicon)/g, '$1="/music/$2');
  fs.writeFileSync(loginHtml, h);
  console.log('[patch] solara: login.html favicon 路径修正');
}

console.log('[patch] solara 完成');
