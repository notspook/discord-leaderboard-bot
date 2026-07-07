const { createCanvas, loadImage } = require("canvas");

async function generateQuoteCard(avatarURL, username, quoteText) {
  const W = 600;
  const H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background — solid dark
  ctx.fillStyle = "#0d0e10";
  ctx.fillRect(0, 0, W, H);

  // Load and draw avatar on the left as a square with fade to right
  try {
    const avatar = await loadImage(avatarURL);

    // Draw avatar filling left ~45% of card
    const avatarW = Math.floor(W * 0.45);
    ctx.drawImage(avatar, 0, 0, avatarW, H);

    // Fade the avatar out to the right using a gradient
    const fade = ctx.createLinearGradient(avatarW * 0.35, 0, avatarW, 0);
    fade.addColorStop(0, "rgba(13,14,16,0)");
    fade.addColorStop(1, "rgba(13,14,16,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, avatarW, H);
  } catch (e) {
    // If avatar fails just leave dark background
  }

  // Opening quote mark
  ctx.font = "bold 64px serif";
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillText("\u201C", W * 0.47, 80);

  // Quote text — word wrap
  const maxWidth = W * 0.46;
  const lineHeight = 30;
  const startX = W * 0.48;
  let startY = 100;

  ctx.font = "600 18px sans-serif";
  ctx.fillStyle = "#ffffff";

  const words = quoteText.split(" ");
  let line = "";
  const lines = [];

  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxWidth && line !== "") {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trim());

  // Limit to 6 lines
  const displayLines = lines.slice(0, 6);
  if (lines.length > 6) displayLines[5] = displayLines[5].slice(0, -3) + "...";

  // Vertically center the text block
  const totalTextH = displayLines.length * lineHeight;
  startY = (H - totalTextH - 40) / 2 + 20;

  for (const l of displayLines) {
    ctx.fillText(l, startX, startY);
    startY += lineHeight;
  }

  // Author line
  ctx.font = "500 14px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(`— ${username}`, startX, startY + 12);

  return canvas.toBuffer("image/png");
}

module.exports = { generateQuoteCard };
