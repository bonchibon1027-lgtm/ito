// OGP PNG画像をCanvasで生成（Node.js + canvas パッケージ使用）
// Render.comのビルド時に実行される
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const W = 1200, H = 630;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Background
ctx.fillStyle = '#07090f';
ctx.fillRect(0, 0, W, H);

// Top accent bar (gradient simulation)
const topBar = ctx.createLinearGradient(0, 0, W, 0);
topBar.addColorStop(0, '#00b4d8');
topBar.addColorStop(1, '#0078d4');
ctx.fillStyle = topBar;
ctx.fillRect(0, 0, W, 5);

// Background card decorations
const cards = [
  { x: 720, y: 80, num: '23', op: 0.25 },
  { x: 880, y: 60, num: '67', op: 0.35 },
  { x: 1040, y: 90, num: '91', op: 0.2 },
  { x: 750, y: 360, num: '42', op: 0.15 },
  { x: 910, y: 380, num: '8', op: 0.12 },
];
cards.forEach(({ x, y, num, op }) => {
  ctx.save();
  ctx.globalAlpha = op;
  // Card shape
  ctx.fillStyle = '#131922';
  roundRect(ctx, x, y, 140, 190, 16);
  ctx.fill();
  ctx.strokeStyle = '#253045';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, 140, 190, 16);
  ctx.stroke();
  // Number
  ctx.fillStyle = '#253045';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(num, x + 70, y + 130);
  ctx.restore();
});

// Main title "ITO"
const titleGrad = ctx.createLinearGradient(40, 0, 280, 0);
titleGrad.addColorStop(0, '#00b4d8');
titleGrad.addColorStop(1, '#0078d4');
ctx.fillStyle = titleGrad;
ctx.font = 'bold 150px sans-serif';
ctx.textAlign = 'center';

// Glow effect
ctx.shadowColor = '#0078d4';
ctx.shadowBlur = 30;
ctx.fillText('ITO', 160, 265);
ctx.shadowBlur = 0;

// Japanese subtitle
ctx.fillStyle = '#4a5568';
ctx.font = '32px sans-serif';
ctx.letterSpacing = '8px';
ctx.fillText('糸', 160, 320);

// Divider line
ctx.strokeStyle = '#1c2535';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(60, 350);
ctx.lineTo(260, 350);
ctx.stroke();

// Description
ctx.fillStyle = '#4a5568';
ctx.font = '22px sans-serif';
ctx.textAlign = 'center';
ctx.fillText('数字で語るカードゲーム', 160, 395);

// Tags
drawTag(ctx, 60, 430, 145, 'オンライン対戦');
drawTag(ctx, 215, 430, 100, '最大8人');

// URL
ctx.fillStyle = '#253045';
ctx.font = '20px sans-serif';
ctx.textAlign = 'center';
ctx.fillText('ito-2yg4.onrender.com', 600, 575);

// Border
ctx.strokeStyle = '#1c2535';
ctx.lineWidth = 1;
ctx.strokeRect(1, 1, W - 2, H - 2);

// Save
const out = fs.createWriteStream(path.join(__dirname, 'public', 'ogp.png'));
const stream = canvas.createPNGStream();
stream.pipe(out);
out.on('finish', () => console.log('✅ ogp.png generated'));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawTag(ctx, x, y, w, text) {
  ctx.save();
  ctx.fillStyle = '#0d1117';
  roundRect(ctx, x, y, w, 36, 18);
  ctx.fill();
  ctx.strokeStyle = '#1c2535';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, 36, 18);
  ctx.stroke();
  ctx.fillStyle = '#4a5568';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 23);
  ctx.restore();
}
