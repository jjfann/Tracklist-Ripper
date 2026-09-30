// Draws a playlist cover: the video thumbnail as a record sleeve with a
// rosewood record sliding out. Returns base64 JPEG (no data: prefix).

const SIZE = 600;

async function loadThumb(videoId) {
  if (!videoId) return null;
  for (const name of ['maxresdefault', 'hqdefault']) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${name}.jpg`);
      if (res.ok) return await createImageBitmap(await res.blob());
    } catch {
      /* try the next size */
    }
  }
  return null;
}

function drawRecord(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#1b1416';
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 30;
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (let rr = r * 0.4; rr < r * 0.97; rr += 3.2) {
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // sheen
  const g = ctx.createConicGradient(0.4, cx, cy);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.1, 'rgba(255,255,255,.12)');
  g.addColorStop(0.18, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.addColorStop(0.66, 'rgba(255,255,255,.08)');
  g.addColorStop(0.72, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = '#8c3040';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(242,217,140,.5)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#fbf4e4';
  ctx.fill();
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
  }
  return lines;
}

function drawSleeve(ctx, img, title, x, y, s) {
  ctx.save();
  ctx.shadowColor = 'rgba(20,5,9,.55)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetX = 8;
  ctx.fillStyle = '#efe3c8';
  ctx.fillRect(x, y, s, s);
  ctx.restore();

  if (img) {
    // centre-crop the 16:9 thumbnail to a square
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, x + 8, y + 8, s - 16, s - 16);
    return;
  }

  // No thumbnail (pasted tracklist): a typeset sleeve.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, s, s);
  ctx.clip();
  ctx.fillStyle = '#f2d98c';
  ctx.fillRect(x, y + s - 70, s, 70);
  ctx.fillStyle = '#8c3040';
  ctx.fillRect(x, y + s - 78, s, 8);
  ctx.font = '700 44px Fraunces, Georgia, serif';
  const lines = wrapLines(ctx, title || 'Ripped tracklist', s - 60, 4);
  lines.forEach((l, i) => ctx.fillText(l, x + 30, y + 70 + i * 50));
  ctx.restore();
}

export async function makeCover({ videoId, title }) {
  await document.fonts.load('700 30px Fraunces').catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createRadialGradient(SIZE * 0.6, SIZE * 0.4, 50, SIZE / 2, SIZE / 2, SIZE * 0.75);
  bg.addColorStop(0, '#a13a4b');
  bg.addColorStop(1, '#5e1f2b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const img = await loadThumb(videoId);
  drawRecord(ctx, 405, 300, 200);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, SIZE, SIZE);
  ctx.clip();
  drawSleeve(ctx, img, title, 40, 110, 380);
  ctx.restore();

  ctx.fillStyle = '#f2d98c';
  ctx.font = '700 22px Fraunces, Georgia, serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('TRACKLIST RIPPER', 40, 70);

  return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
}
