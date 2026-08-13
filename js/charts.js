/**
 * Fixed High-Precision Canvas Chart Visualizer
 * Fully constrained dimensions, retina-ready, zero overflow.
 */

import { CATEGORIES } from './smsParser.js';
import { formatINR } from './store.js';

export function renderCategoryDonutChart(canvas, categorySpends = {}, legendContainer = null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Fixed internal logical dimensions for stable layout
  const size = 180;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  const entries = Object.entries(categorySpends)
    .filter(([_, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((acc, [_, amt]) => acc + amt, 0);

  const centerX = size / 2;
  const centerY = size / 2;
  const radius = 78;
  const innerRadius = 50;

  if (total === 0 || entries.length === 0) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.arc(centerX, centerY, innerRadius, Math.PI * 2, 0, true);
    ctx.fillStyle = 'rgba(100, 116, 139, 0.15)';
    ctx.fill();

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No Spends', centerX, centerY);
    ctx.restore();

    if (legendContainer) {
      legendContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 1rem 0;">No expenses logged this month</div>';
    }
    return;
  }

  let currentAngle = -Math.PI / 2;

  entries.forEach(([catId, amount]) => {
    const sliceAngle = (amount / total) * Math.PI * 2;
    const catInfo = CATEGORIES[catId.toUpperCase()] || { name: catId, color: '#64748B' };

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
    ctx.arc(centerX, centerY, innerRadius, currentAngle + sliceAngle, currentAngle, true);
    ctx.closePath();

    ctx.fillStyle = catInfo.color;
    ctx.fill();

    // Clean dark separator stroke
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0B0F19';
    ctx.stroke();

    currentAngle += sliceAngle;
  });

  // Center Total Text
  ctx.fillStyle = '#94A3B8';
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TOTAL SPEND', centerX, centerY - 9);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '800 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(formatINR(total, true), centerX, centerY + 9);

  ctx.restore();

  // Update Legend with clean layout
  if (legendContainer) {
    legendContainer.innerHTML = entries.map(([catId, amount]) => {
      const cat = CATEGORIES[catId.toUpperCase()] || { name: catId, color: '#64748B', icon: '🏷️' };
      const pct = ((amount / total) * 100).toFixed(1);
      return `
        <div class="legend-item">
          <div class="legend-left">
            <span class="legend-color" style="background: ${cat.color};"></span>
            <span class="legend-name">${cat.icon} ${cat.name}</span>
          </div>
          <div class="legend-value">${formatINR(amount)} <span class="legend-pct">(${pct}%)</span></div>
        </div>
      `;
    }).join('');
  }
}

export function renderDailyTrendChart(canvas, transactions = []) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  const parent = canvas.parentElement;
  const width = parent ? parent.clientWidth : 480;
  const height = 200;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  // Aggregate spends for last 14 days
  const days = 14;
  const dailyData = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    let debit = 0;
    for (const tx of transactions) {
      if (tx.type === 'debit' && tx.timestamp && tx.timestamp.startsWith(dateStr)) {
        debit += Number(tx.amount);
      }
    }
    dailyData.push({ date: dateStr, label, amount: debit });
  }

  const maxVal = Math.max(500, ...dailyData.map(d => d.amount)) * 1.2;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 22;
  const paddingBottom = 28;

  const chartW = Math.max(100, width - paddingLeft - paddingRight);
  const chartH = Math.max(50, height - paddingTop - paddingBottom);

  // Draw Horizontal Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  const gridSteps = 4;

  for (let i = 0; i <= gridSteps; i++) {
    const y = paddingTop + (chartH / gridSteps) * i;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();

    const val = maxVal - (maxVal / gridSteps) * i;
    ctx.fillStyle = '#64748B';
    ctx.font = '500 10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatINR(val, true), paddingLeft - 6, y);
  }

  // Draw Bars
  const slotWidth = chartW / days;
  const barWidth = Math.min(22, Math.max(8, slotWidth - 6));

  dailyData.forEach((d, idx) => {
    const x = paddingLeft + (idx * slotWidth) + ((slotWidth - barWidth) / 2);
    const barH = (d.amount / maxVal) * chartH;
    const y = paddingTop + chartH - barH;

    if (barH > 0) {
      const gradient = ctx.createLinearGradient(0, y, 0, paddingTop + chartH);
      gradient.addColorStop(0, '#3B82F6');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.25)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      const r = Math.min(4, barWidth / 2);
      ctx.roundRect(x, y, barWidth, Math.max(3, barH), [r, r, 0, 0]);
      ctx.fill();
    }

    // X-Axis labels
    if (idx % 2 === 0 || idx === days - 1) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = '500 9.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(d.label, x + barWidth / 2, height - paddingBottom + 8);
    }
  });

  ctx.restore();
}
