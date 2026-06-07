// OGP PNG画像をCanvasで生成（Node.js + canvas パッケージ使用）
// Render.comのビルド時に実行される
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const W = 1200, H = 630;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Background
ctx.fillStyle = '#1a1a2e';
ctx.fillRect(0, 0, W, H);

// Top accent bar (gradient)
const topBar = ctx.createLinearGradient(0, 0, W, 0);
topBar.addColorStop(0, '#4c8bf5');
topBar.addColorStop(1, '#5bc8f5');
ctx.fillStyle = topBar;
ctx.fillRect(0, 0, W, 6);

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
  ctx.fillStyle = '#232336';
  roundRect(ctx, x, y, 140, 190, 16);
  ctx.fill();
  ctx.strokeStyle = '#3a3a58';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, 140, 190, 16);
  ctx.stroke();
  ctx.fillStyle = '#4a4a6a';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(num, x + 70, y + 130);
  ctx.restore();
});

// Main title "KANDO"
const titleGrad = ctx.createLinearGradient(40, 0, 380, 0);
titleGrad.addColorStop(0, '#4c8bf5');
titleGrad.addColorStop(1, '#5bc8f5');
ctx.fillStyle = titleGrad;
ctx.font = 'bold 120px sans-serif';
ctx.textAlign = 'left';

// Glow effect
ctx.shadowColor = '#4c8bf5';
ctx.shadowBlur = 30;
ctx.fillText('KANDO', 60, 240);
ctx.shadowBlur = 0;

// Japanese subtitle
ctx.fillStyle = '#a0a0c0';
ctx.font = 'bold 28px sans-serif';
ctx.textAlign = 'left';
ctx.fillText('カンド — 感覚をそろえろ', 64, 290);

// Divider line
ctx.strokeStyle = '#3a3a58';
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(60, 320);
ctx.lineTo(560, 320);
ctx.stroke();

// Description
ctx.fillStyle = '#a0a0c0';
ctx.font = '24px sans-serif';
ctx.textAlign = 'left';
ctx.fillText('お題に対して、あなたの感覚は何点？', 64, 365);
ctx.fillText('みんなと感覚をそろえよう！', 64, 398);

// Tags
drawTag(ctx, 64, 440, 160, 'オンライン対戦');
drawTag(ctx, 234, 440, 110, '最大8人');
drawTag(ctx, 354, 440, 80, '無料');

// URL
ctx.fillStyle = '#4a4a6a';
ctx.font = '22px sans-serif';
ctx.textAlign = 'center';
ctx.fillText('ito-2yg4.onrender.com', 600, 585);

// Border
ctx.strokeStyle = '#3a3a58';
ctx.lineWidth = 2;
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
  ctx.fillStyle = '#2c2c44';
  roundRect(ctx, x, y, w, 40, 20);
  ctx.fill();
  ctx.strokeStyle = '#4a4a6a';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, 40, 20);
  ctx.stroke();
  ctx.fillStyle = '#a0a0c0';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 26);
  ctx.restore();
}
