// OGP画像をHTMLで生成してogp.pngとして保存するスクリプト
// node generate-ogp.js で実行
// ※ローカルで実行後、public/ogp.png をgitにコミットする

const fs = require('fs');
const path = require('path');

// SVGをPNGに変換（sharp使用）
// npm install sharp して実行
try {
  const sharp = require('sharp');
  const svgPath = path.join(__dirname, 'public', 'ogp.svg');
  const pngPath = path.join(__dirname, 'public', 'ogp.png');

  sharp(svgPath)
    .resize(1200, 630)
    .png()
    .toFile(pngPath, (err, info) => {
      if (err) { console.error('変換エラー:', err); return; }
      console.log('ogp.png 生成完了:', info);
    });
} catch(e) {
  console.log('sharp未インストール。npm install sharp を実行してください。');
}
