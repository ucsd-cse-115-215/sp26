// heap-diagram.js — custom <heap-diagram> element rendering boundary-tag heaps.
//
// Usage:
//   <heap-diagram wrap="128" start="0x00" title="my heap">
//     alloc 32
//     free 64
//     alloc 32
//     free 32
//     alloc 64
//     free 32
//   </heap-diagram>
//
// Attributes:
//   wrap   — bytes per row before wrapping (default 128)
//   start  — heap start address (decimal or 0x-prefix hex; default 0)
//   title  — optional diagram title shown above the heap
//
// Attribute `legend` — when present, render a small legend bar below the heap.
//
// Attribute `pad` — when present, prepend an N-byte "leading pad" cell at the
//   start of the heap (CSE 29 convention: 8 bytes of alignment padding before
//   the first block, sometimes used for magic numbers or heap-control state).
//   Use `pad` for the default 8 bytes, or `pad="16"` to set a custom size.
//
// Attribute `sentinel` — when present, append an N-byte end-of-heap sentinel
//   cell (an all-zeros header word, size 0 + status 0) so the allocator's heap
//   walk knows where to stop. Use `sentinel` for the default 8 bytes, or
//   `sentinel="16"` to set a custom size.
//
// Block syntax (one per line, or separated by ";"):
//   alloc <size>           — busy block, size in bytes (multiple of 8, min 16)
//   free  <size>           — free block, same size rules; renders header + footer
//
// Optional per-block flags (whitespace-separated, after size, any order):
//   ptr   (or *)           — red lollipop marker at the start of this block's payload
//   hl    (or ! highlight) — red outline on this block (e.g. "changed by op")

(function () {
  'use strict';

  const PX_PER_BYTE = 4;
  const INSET = 2;
  const BLOCK_H = 36;
  const HEADER_PX = 32;   // 8 bytes * 4 px/byte
  const ROW_GAP = 22;
  const HEAP_LEFT_X = 50;
  const ADDR_X = 44;
  const TITLE_Y = 22;

  const COLORS = {
    bg:        '#fbf5e8',
    hdrBg:     '#2c2218',
    allocBg:   '#3a5d8c',
    textLight: '#fbf5e8',
    textMuted: '#5a4a3a',
    dim:       '#8a7560',
    bright:    '#fff8e0',
    title:     '#2a2a2a',
    divider:   '#5a4a3a',
  };

  // ---------- helpers ----------

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hex8(n) {
    return '0x' + (n >>> 0).toString(16).padStart(8, '0');
  }

  function hexAddr(n) {
    const h = n.toString(16);
    return '0x' + (h.length % 2 ? '0' : '') + h;
  }

  function bitsOfLowNibble(n) {
    const m = n & 0xf;
    return [(m >> 3) & 1, (m >> 2) & 1, (m >> 1) & 1, m & 1];
  }

  function statusDescr(ss) {
    const pb = (ss & 0x2) ? 'Prev Busy' : 'Prev Free';
    const b  = (ss & 0x1) ? 'This Busy' : 'This Free';
    return pb + ', ' + b;
  }

  function parseStart(s) {
    if (!s) return 0;
    if (/^0x/i.test(s)) return parseInt(s.slice(2), 16) || 0;
    return parseInt(s, 10) || 0;
  }

  // ---------- parser ----------

  function parseBlocks(text) {
    const tokens = text.split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
    const blocks = [];
    for (const tok of tokens) {
      const parts = tok.split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        console.error(`heap-diagram: skipping malformed block (need "kind size [flags...]"): "${tok}"`);
        continue;
      }
      const kind = parts[0].toLowerCase();
      if (kind !== 'alloc' && kind !== 'free') {
        console.error(`heap-diagram: skipping block — kind must be "alloc" or "free", got "${parts[0]}" in "${tok}"`);
        continue;
      }
      const size = parseInt(parts[1], 10);
      if (!Number.isInteger(size)) {
        console.error(`heap-diagram: skipping block — size must be an integer, got "${parts[1]}" in "${tok}"`);
        continue;
      }
      if (size < 16 || size % 8 !== 0) {
        console.error(`heap-diagram: skipping block — size must be ≥ 16 and a multiple of 8, got ${size} in "${tok}"`);
        continue;
      }
      const flags = parts.slice(2).map(f => f.toLowerCase());
      const isPtr = flags.some(f => f === 'ptr' || f === '*');
      const isHighlight = flags.some(f => f === 'hl' || f === '!' || f === 'highlight');
      const unknown = flags.filter(f => !['ptr', '*', 'hl', '!', 'highlight'].includes(f));
      if (unknown.length) {
        console.error(`heap-diagram: unknown flag(s) ${unknown.join(', ')} in "${tok}" — supported flags: ptr, hl`);
      }
      blocks.push({ kind, size, isPtr, isHighlight });
    }
    return blocks;
  }

  // ---------- layout ----------

  function layoutHeap(blocks, wrapBytes, startAddr, padSize, sentinelSize) {
    let all = padSize > 0 ? [{ kind: 'pad', size: padSize }, ...blocks] : blocks;
    if (sentinelSize > 0) all = [...all, { kind: 'sentinel', size: sentinelSize }];
    const rows = [];
    let row = [];
    let rowBytes = 0;
    let rowStart = startAddr;
    let addr = startAddr;
    let prevBusy = true; // sentinel before heap start is treated as busy
    const MIN_PIECE = 8; // header word width; a split piece must be at least this big

    const finishRow = () => {
      rows.push({ blocks: row, startAddr: rowStart });
      row = [];
      rowBytes = 0;
      rowStart = addr;
    };

    for (const b of all) {
      let common;
      if (b.kind === 'pad' || b.kind === 'sentinel') {
        common = { kind: b.kind, parentSize: b.size };
      } else {
        const isBusy = b.kind === 'alloc';
        const sizeStatus = b.size | (prevBusy ? 0x2 : 0) | (isBusy ? 0x1 : 0);
        common = {
          kind: b.kind, parentSize: b.size, isBusy, prevBusy, sizeStatus,
          isPtr: !!b.isPtr, isHighlight: !!b.isHighlight,
        };
        prevBusy = isBusy;
      }

      let remaining = b.size;
      let isFirstPiece = true;
      while (remaining > 0) {
        const spaceLeft = wrapBytes - rowBytes;
        if (remaining <= spaceLeft) {
          row.push({ ...common, size: remaining, addr, isFirstPiece, isLastPiece: true });
          rowBytes += remaining;
          addr += remaining;
          remaining = 0;
          break;
        }
        // Need to split. Reserve at least MIN_PIECE for the right-side piece.
        let take = spaceLeft;
        if (remaining - take < MIN_PIECE) take = remaining - MIN_PIECE;
        if (take < MIN_PIECE || spaceLeft < MIN_PIECE) {
          if (row.length === 0) break; // pathological: can't fit and row empty; bail
          finishRow();
          continue;
        }
        row.push({ ...common, size: take, addr, isFirstPiece, isLastPiece: false });
        rowBytes += take;
        addr += take;
        remaining -= take;
        isFirstPiece = false;
        finishRow();
      }
    }
    if (row.length) finishRow();
    return rows;
  }

  // ---------- SVG fragments ----------

  function svgDefs() {
    return `<defs>
      <filter id="rough" x="-2%" y="-3%" width="104%" height="106%">
        <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="6" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2"/>
      </filter>
      <pattern id="freeDots" patternUnits="userSpaceOnUse" width="9" height="9">
        <rect width="9" height="9" fill="${COLORS.bg}"/>
        <circle cx="4.5" cy="4.5" r="1.1" fill="#b08850"/>
      </pattern>
      <pattern id="padPattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)">
        <rect width="6" height="6" fill="#b8a878"/>
        <line x1="0" y1="0" x2="0" y2="6" stroke="#5a4a3a" stroke-width="1.2"/>
      </pattern>
      <filter id="popShadow" x="-5%" y="-10%" width="110%" height="130%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.22"/>
      </filter>
    </defs>`;
  }

  function svgStyles() {
    return `<style>
      .header-hit, .footer-hit { cursor: help; }
      .cursor-popup { opacity: 0; pointer-events: none; transition: opacity 0.12s ease; }
    </style>`;
  }

  // Path outlining one piece of a (possibly split) block. Sides marked torn
  // are drawn as a 4-tooth zigzag instead of a straight rounded edge.
  function pieceShapePath(x, y, w, h, tornLeft, tornRight) {
    const r = 4;
    const teeth = 4;
    const depth = 5;
    const xR = x + w;
    const yB = y + h;
    let d = tornLeft ? `M ${x} ${y} ` : `M ${x + r} ${y} `;
    if (tornRight) {
      d += `L ${xR} ${y} `;
    } else {
      d += `L ${xR - r} ${y} A ${r} ${r} 0 0 1 ${xR} ${y + r} `;
    }
    if (tornRight) {
      for (let i = 0; i < teeth; i++) {
        const seg = h / teeth;
        const midY = y + i * seg + seg / 2;
        const endY = y + (i + 1) * seg;
        d += `L ${xR - depth} ${midY} L ${xR} ${endY} `;
      }
    } else {
      d += `L ${xR} ${yB - r} A ${r} ${r} 0 0 1 ${xR - r} ${yB} `;
    }
    if (tornLeft) {
      d += `L ${x} ${yB} `;
    } else {
      d += `L ${x + r} ${yB} A ${r} ${r} 0 0 1 ${x} ${yB - r} `;
    }
    if (tornLeft) {
      for (let i = teeth - 1; i >= 0; i--) {
        const seg = h / teeth;
        const midY = y + i * seg + seg / 2;
        const startY = y + i * seg;
        d += `L ${x + depth} ${midY} L ${x} ${startY} `;
      }
    } else {
      d += `L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} `;
    }
    return d + 'Z';
  }

  function renderStripLines(xStart, yTop) {
    let svg = '';
    svg += `<line x1="${xStart + 2}" y1="${yTop}" x2="${xStart + 30}" y2="${yTop}" stroke="${COLORS.textLight}" stroke-width="0.5" opacity="0.55"/>`;
    for (let i = 1; i < 4; i++) {
      const x = xStart + 2 + i * 7;
      svg += `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yTop + 10}" stroke="${COLORS.textLight}" stroke-width="0.4" opacity="0.4"/>`;
    }
    return svg;
  }

  function renderStripDigits(xStart, yBase, bits) {
    let svg = '';
    for (let i = 0; i < 4; i++) {
      const cx = xStart + 2 + i * 7 + 3.5;
      const v = bits[i];
      const color = v ? COLORS.bright : COLORS.dim;
      const weight = v ? 'bold' : 'normal';
      svg += `<text x="${cx}" y="${yBase}" text-anchor="middle" font-size="7" fill="${color}" font-family="ui-monospace, monospace" font-weight="${weight}">${v}</text>`;
    }
    return svg;
  }

  let _clipCounter = 0;

  function renderBlock(b, rowY, rowStartAddr) {
    const totalPx = b.size * PX_PER_BYTE;
    const logicalX = HEAP_LEFT_X + (b.addr - rowStartAddr) * PX_PER_BYTE;
    const insetX = logicalX + INSET;
    const insetW = totalPx - 2 * INSET;
    const blockH = BLOCK_H;
    const hasHeader = b.isFirstPiece;
    const hasFooter = !b.isBusy && b.isLastPiece;
    const tornLeft = !b.isFirstPiece;
    const tornRight = !b.isLastPiece;
    const hdrX = insetX;
    const footerX = hasFooter ? (insetX + insetW - HEADER_PX) : null;
    const payloadX = hasHeader ? (hdrX + HEADER_PX) : insetX;
    const payloadEnd = hasFooter ? footerX : (insetX + insetW);
    const payloadW = payloadEnd - payloadX;
    const fillBg = b.isBusy ? COLORS.allocBg : 'url(#freeDots)';
    const stripY = rowY + 20;
    const digitY = rowY + 28;

    const clipId = 'hd_cp_' + (_clipCounter++);
    const shape = pieceShapePath(insetX, rowY, insetW, blockH, tornLeft, tornRight);
    let svg = '';

    svg += `<defs><clipPath id="${clipId}"><path d="${shape}"/></clipPath></defs>`;

    svg += `<g clip-path="url(#${clipId})">`;
    if (hasHeader) {
      svg += `<rect x="${hdrX}" y="${rowY}" width="${HEADER_PX}" height="${blockH}" fill="${COLORS.hdrBg}"/>`;
    }
    svg += `<rect x="${payloadX}" y="${rowY}" width="${payloadW}" height="${blockH}" fill="${fillBg}"/>`;
    if (hasFooter) {
      svg += `<rect x="${footerX}" y="${rowY}" width="${HEADER_PX}" height="${blockH}" fill="${COLORS.hdrBg}"/>`;
    }
    if (hasHeader) svg += renderStripLines(hdrX, stripY);
    if (hasFooter) svg += renderStripLines(footerX, stripY);
    svg += `</g>`;

    // Interior dashed dividers (only at header/footer boundaries)
    if (hasHeader) {
      const dividerColor = b.isBusy ? COLORS.textLight : COLORS.divider;
      const dividerW = b.isBusy ? 1 : 0.8;
      const dividerOp = b.isBusy ? 0.55 : 0.6;
      svg += `<line x1="${payloadX}" y1="${rowY}" x2="${payloadX}" y2="${rowY + blockH}" stroke="${dividerColor}" stroke-width="${dividerW}" stroke-dasharray="4,3" opacity="${dividerOp}"/>`;
    }
    if (hasFooter) {
      svg += `<line x1="${footerX}" y1="${rowY}" x2="${footerX}" y2="${rowY + blockH}" stroke="${COLORS.divider}" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.6"/>`;
    }

    // Rough outer outline (red + thicker when highlighted)
    const outlineColor = b.isHighlight ? '#c5302a' : COLORS.hdrBg;
    const outlineWidth = b.isHighlight ? 2.4 : 1.6;
    svg += `<g filter="url(#rough)"><path d="${shape}" fill="none" stroke="${outlineColor}" stroke-width="${outlineWidth}"/></g>`;

    // Size text on header (and footer for free blocks); shows the PARENT block size
    const sizeY = rowY + 15;
    if (hasHeader) {
      const hdrCenterX = hdrX + HEADER_PX / 2;
      svg += `<text x="${hdrCenterX}" y="${sizeY}" text-anchor="middle" font-size="12" fill="${COLORS.textLight}">${b.parentSize}</text>`;
    }
    if (hasFooter) {
      const ftrCenterX = footerX + HEADER_PX / 2;
      svg += `<text x="${ftrCenterX}" y="${sizeY}" text-anchor="middle" font-size="12" fill="${COLORS.textLight}">${b.parentSize}</text>`;
    }

    // Bit strip digits
    const bits = bitsOfLowNibble(b.sizeStatus);
    if (hasHeader) svg += renderStripDigits(hdrX, digitY, bits);
    if (hasFooter) svg += renderStripDigits(footerX, digitY, bits);

    // Hit rects (header and optionally footer)
    const totalDesc = !b.isBusy
      ? `Total: ${b.parentSize} bytes (header 8, payload ${b.parentSize - 16}, footer 8)`
      : `Total: ${b.parentSize} bytes (header 8, payload ${b.parentSize - 8})`;
    const headerWord = `Header word ${hex8(b.sizeStatus)}`;
    const statusLine = `Status: 0x${(b.sizeStatus & 0xf).toString(16)} = 0b${bits.join('')} (${statusDescr(b.sizeStatus)})`;

    if (hasHeader) {
      svg += `<rect class="header-hit" x="${hdrX}" y="${rowY}" width="${HEADER_PX}" height="${blockH}" fill="transparent" pointer-events="all" data-total="${esc(totalDesc)}" data-header="${esc(headerWord)}" data-status="${esc(statusLine)}"/>`;
    }

    if (hasFooter) {
      const l1 = `Footer: marks this free block's length (${b.parentSize}),`;
      const l2 = `so it can merge with the next block when it frees.`;
      svg += `<rect class="footer-hit" x="${footerX}" y="${rowY}" width="${HEADER_PX}" height="${blockH}" fill="transparent" pointer-events="all" data-line1="${esc(l1)}" data-line2="${esc(l2)}"/>`;
    }

    // Pointer marker (drawn last so it sits on top of the outline) — first piece only
    if (b.isPtr && b.isFirstPiece) {
      svg += `<circle cx="${payloadX}" cy="${rowY}" r="5.5" fill="#c5302a" stroke="#2c2218" stroke-width="1.6" pointer-events="none"/>`;
      svg += `<circle cx="${payloadX}" cy="${rowY}" r="1.8" fill="#fbf5e8" pointer-events="none"/>`;
    }

    return svg;
  }

  function renderPad(b, rowY, rowStartAddr) {
    const totalPx = b.size * PX_PER_BYTE;
    const logicalX = HEAP_LEFT_X + (b.addr - rowStartAddr) * PX_PER_BYTE;
    const insetX = logicalX + INSET;
    const insetW = totalPx - 2 * INSET;
    const blockH = BLOCK_H;
    const tornLeft = !b.isFirstPiece;
    const tornRight = !b.isLastPiece;
    const shape = pieceShapePath(insetX, rowY, insetW, blockH, tornLeft, tornRight);
    let svg = '';

    svg += `<path d="${shape}" fill="url(#padPattern)"/>`;
    svg += `<g filter="url(#rough)"><path d="${shape}" fill="none" stroke="${COLORS.hdrBg}" stroke-width="1.6"/></g>`;
    if (b.isFirstPiece) {
      svg += `<text x="${insetX + insetW / 2}" y="${rowY + BLOCK_H / 2 + 4}" text-anchor="middle" font-size="11" fill="${COLORS.textMuted}">pad</text>`;
    }

    const l1 = `Leading pad: ${b.parentSize} bytes of alignment so the first block's payload is 16-byte aligned.`;
    const l2 = `Implementations sometimes stash magic numbers or heap-control metadata here.`;
    svg += `<rect class="pad-hit" x="${insetX}" y="${rowY}" width="${insetW}" height="${blockH}" fill="transparent" pointer-events="all" data-line1="${esc(l1)}" data-line2="${esc(l2)}"/>`;
    return svg;
  }

  function renderSentinel(b, rowY, rowStartAddr) {
    const totalPx = b.size * PX_PER_BYTE;
    const logicalX = HEAP_LEFT_X + (b.addr - rowStartAddr) * PX_PER_BYTE;
    const insetX = logicalX + INSET;
    const insetW = totalPx - 2 * INSET;
    const blockH = BLOCK_H;
    const stripY = rowY + 20;
    const digitY = rowY + 28;
    const tornLeft = !b.isFirstPiece;
    const tornRight = !b.isLastPiece;
    const shape = pieceShapePath(insetX, rowY, insetW, blockH, tornLeft, tornRight);
    let svg = '';

    svg += `<path d="${shape}" fill="${COLORS.hdrBg}"/>`;
    if (b.isFirstPiece) svg += renderStripLines(insetX, stripY);
    svg += `<g filter="url(#rough)"><path d="${shape}" fill="none" stroke="${COLORS.hdrBg}" stroke-width="1.6"/></g>`;
    if (b.isFirstPiece) {
      svg += `<text x="${insetX + insetW / 2}" y="${rowY + 15}" text-anchor="middle" font-size="12" fill="${COLORS.textLight}">0</text>`;
      svg += renderStripDigits(insetX, digitY, [0, 0, 0, 0]);
    }

    const l1 = `End-of-heap sentinel: header word 0x00000000.`;
    const l2 = `Size 0 + status 0 tells the allocator's heap walk to stop here.`;
    svg += `<rect class="sentinel-hit" x="${insetX}" y="${rowY}" width="${insetW}" height="${blockH}" fill="transparent" pointer-events="all" data-line1="${esc(l1)}" data-line2="${esc(l2)}"/>`;
    return svg;
  }

  function renderRow(row, rowY) {
    let svg = '';
    const addrTxt = hexAddr(row.startAddr);
    svg += `<text x="${ADDR_X}" y="${rowY + BLOCK_H / 2 + 4}" text-anchor="end" font-size="10" fill="${COLORS.textMuted}" font-family="ui-monospace, monospace">${addrTxt}</text>`;
    for (const b of row.blocks) {
      if (b.kind === 'pad') svg += renderPad(b, rowY, row.startAddr);
      else if (b.kind === 'sentinel') svg += renderSentinel(b, rowY, row.startAddr);
      else svg += renderBlock(b, rowY, row.startAddr);
    }
    return svg;
  }

  function renderPopups() {
    return `<g class="cursor-popup popup-header" transform="translate(0,0)">
      <rect width="300" height="50" rx="4" fill="#fdf8e8" stroke="${COLORS.hdrBg}" stroke-width="1.1" filter="url(#popShadow)"/>
      <text class="popup-total" x="10" y="16" font-size="9" font-family="ui-monospace, monospace" fill="#3a302a">—</text>
      <text class="popup-headword" x="10" y="30" font-size="9" font-family="ui-monospace, monospace" fill="#3a302a">—</text>
      <text class="popup-status" x="10" y="44" font-size="9" font-family="ui-monospace, monospace" fill="#3a302a">—</text>
    </g>
    <g class="cursor-popup popup-footer" transform="translate(0,0)">
      <rect width="320" height="34" rx="4" fill="#fdf8e8" stroke="${COLORS.hdrBg}" stroke-width="1.1" filter="url(#popShadow)"/>
      <text class="popup-line1" x="10" y="15" font-size="9" font-style="italic" font-family="system-ui, sans-serif" fill="#3a302a">—</text>
      <text class="popup-line2" x="10" y="28" font-size="9" font-style="italic" font-family="system-ui, sans-serif" fill="#3a302a">—</text>
    </g>
    <g class="cursor-popup popup-pad" transform="translate(0,0)">
      <rect width="400" height="34" rx="4" fill="#fdf8e8" stroke="${COLORS.hdrBg}" stroke-width="1.1" filter="url(#popShadow)"/>
      <text class="popup-line1" x="10" y="15" font-size="9" font-style="italic" font-family="system-ui, sans-serif" fill="#3a302a">—</text>
      <text class="popup-line2" x="10" y="28" font-size="9" font-style="italic" font-family="system-ui, sans-serif" fill="#3a302a">—</text>
    </g>
    <g class="cursor-popup popup-sentinel" transform="translate(0,0)">
      <rect width="360" height="34" rx="4" fill="#fdf8e8" stroke="${COLORS.hdrBg}" stroke-width="1.1" filter="url(#popShadow)"/>
      <text class="popup-line1" x="10" y="15" font-size="9" font-style="italic" font-family="system-ui, sans-serif" fill="#3a302a">—</text>
      <text class="popup-line2" x="10" y="28" font-size="9" font-style="italic" font-family="system-ui, sans-serif" fill="#3a302a">—</text>
    </g>`;
  }

  function renderLegend(y, withPad) {
    let svg = `<g font-size="11" fill="#2a2a2a">`;
    svg += `<rect x="40"  y="${y}" width="14" height="11" rx="2" fill="${COLORS.hdrBg}"/>`;
    svg += `<text x="60"  y="${y + 9}">hdr / ftr</text>`;
    svg += `<rect x="120" y="${y}" width="14" height="11" rx="2" fill="${COLORS.allocBg}"/>`;
    svg += `<text x="140" y="${y + 9}">alloc</text>`;
    svg += `<rect x="180" y="${y}" width="14" height="11" rx="2" fill="url(#freeDots)" stroke="${COLORS.divider}" stroke-width="0.5"/>`;
    svg += `<text x="200" y="${y + 9}">free</text>`;
    let x = 235;
    if (withPad) {
      svg += `<rect x="${x}" y="${y}" width="14" height="11" rx="2" fill="url(#padPattern)" stroke="${COLORS.divider}" stroke-width="0.5"/>`;
      svg += `<text x="${x + 20}" y="${y + 9}">pad</text>`;
      x += 60;
    }
    svg += `<circle cx="${x + 6}" cy="${y + 5.5}" r="5" fill="#c5302a" stroke="#2c2218" stroke-width="1.4"/>`;
    svg += `<circle cx="${x + 6}" cy="${y + 5.5}" r="1.6" fill="#fbf5e8"/>`;
    svg += `<text x="${x + 18}" y="${y + 9}" fill="#c5302a">returned ptr</text>`;
    x += 90;
    svg += `<rect x="${x}" y="${y}" width="14" height="11" rx="2" fill="none" stroke="#c5302a" stroke-width="2"/>`;
    svg += `<text x="${x + 20}" y="${y + 9}" fill="#c5302a">changed by op</text>`;
    svg += `</g>`;
    return svg;
  }

  function renderSVG(rows, wrapBytes, title, withLegend, withPad) {
    const heapPx = wrapBytes * PX_PER_BYTE;
    const svgW = HEAP_LEFT_X + heapPx + 14;
    const titleH = title ? TITLE_Y + 14 : 14;
    const rowsH = rows.length * BLOCK_H + Math.max(0, rows.length - 1) * ROW_GAP;
    const legendH = withLegend ? 24 : 0;
    const bottomPad = 14;
    const svgH = titleH + rowsH + legendH + bottomPad;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" font-family="'Bradley Hand', 'Caveat', 'Comic Sans MS', cursive" font-size="13">`;
    svg += svgDefs();
    svg += svgStyles();
    svg += `<rect width="100%" height="100%" fill="${COLORS.bg}"/>`;
    if (title) {
      svg += `<text x="${svgW / 2}" y="${TITLE_Y}" text-anchor="middle" font-size="17" fill="${COLORS.title}">${esc(title)}</text>`;
    }
    let y = titleH;
    for (const row of rows) {
      svg += renderRow(row, y);
      y += BLOCK_H + ROW_GAP;
    }
    if (withLegend) {
      svg += renderLegend(y - ROW_GAP + 8, withPad);
    }
    svg += renderPopups();
    svg += `</svg>`;
    return svg;
  }

  // ---------- interactivity ----------

  function attachInteractivity(svg) {
    const popupHeader   = svg.querySelector('.popup-header');
    const popupFooter   = svg.querySelector('.popup-footer');
    const popupPad      = svg.querySelector('.popup-pad');
    const popupSentinel = svg.querySelector('.popup-sentinel');
    if (!popupHeader || !popupFooter || !popupPad || !popupSentinel) return;

    const ht = popupHeader.querySelector('.popup-total');
    const hh = popupHeader.querySelector('.popup-headword');
    const hs = popupHeader.querySelector('.popup-status');
    const f1 = popupFooter.querySelector('.popup-line1');
    const f2 = popupFooter.querySelector('.popup-line2');
    const p1 = popupPad.querySelector('.popup-line1');
    const p2 = popupPad.querySelector('.popup-line2');
    const s1 = popupSentinel.querySelector('.popup-line1');
    const s2 = popupSentinel.querySelector('.popup-line2');

    const vb = svg.viewBox.baseVal;
    const HDR_W = 300, HDR_H = 50;
    const FTR_W = 320, FTR_H = 34;
    const PAD_W = 400, PAD_H = 34;
    const SEN_W = 360, SEN_H = 34;
    const GAP = 10;

    // Position the popup laterally to the hovered hit element.
    // Prefer right side; flip to left if it would overflow the viewBox.
    function positionLaterally(popup, hitEl, w, h) {
      const bb = hitEl.getBBox();
      let px = bb.x + bb.width + GAP;
      if (px + w > vb.width - 2) {
        px = bb.x - w - GAP;
      }
      // Final clamp in case neither side fits (very narrow viewBox)
      if (px < 2) px = 2;
      if (px + w > vb.width - 2) px = vb.width - w - 2;

      // Vertical: anchor at hit top, clamp into viewBox
      let py = bb.y;
      if (py + h > vb.height - 2) py = vb.height - h - 2;
      if (py < 2) py = 2;

      popup.setAttribute('transform', 'translate(' + px + ',' + py + ')');
    }

    function hideAll() {
      popupHeader.style.opacity = '0';
      popupFooter.style.opacity = '0';
      popupPad.style.opacity = '0';
      popupSentinel.style.opacity = '0';
    }

    svg.querySelectorAll('.header-hit').forEach(el => {
      el.addEventListener('mouseenter', () => {
        ht.textContent = el.getAttribute('data-total');
        hh.textContent = el.getAttribute('data-header');
        hs.textContent = el.getAttribute('data-status');
        hideAll();
        positionLaterally(popupHeader, el, HDR_W, HDR_H);
        popupHeader.style.opacity = '1';
      });
      el.addEventListener('mouseleave', () => { popupHeader.style.opacity = '0'; });
    });

    svg.querySelectorAll('.footer-hit').forEach(el => {
      el.addEventListener('mouseenter', () => {
        f1.textContent = el.getAttribute('data-line1');
        f2.textContent = el.getAttribute('data-line2');
        hideAll();
        positionLaterally(popupFooter, el, FTR_W, FTR_H);
        popupFooter.style.opacity = '1';
      });
      el.addEventListener('mouseleave', () => { popupFooter.style.opacity = '0'; });
    });

    svg.querySelectorAll('.pad-hit').forEach(el => {
      el.addEventListener('mouseenter', () => {
        p1.textContent = el.getAttribute('data-line1');
        p2.textContent = el.getAttribute('data-line2');
        hideAll();
        positionLaterally(popupPad, el, PAD_W, PAD_H);
        popupPad.style.opacity = '1';
      });
      el.addEventListener('mouseleave', () => { popupPad.style.opacity = '0'; });
    });

    svg.querySelectorAll('.sentinel-hit').forEach(el => {
      el.addEventListener('mouseenter', () => {
        s1.textContent = el.getAttribute('data-line1');
        s2.textContent = el.getAttribute('data-line2');
        hideAll();
        positionLaterally(popupSentinel, el, SEN_W, SEN_H);
        popupSentinel.style.opacity = '1';
      });
      el.addEventListener('mouseleave', () => { popupSentinel.style.opacity = '0'; });
    });
  }

  // ---------- custom element ----------

  function injectPageStyles() {
    if (document.querySelector('style[data-heap-diagram]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-heap-diagram', '');
    style.textContent =
      'heap-diagram { display: block; max-width: 760px; margin: 1em 0; }' +
      'heap-diagram svg { width: 100%; height: auto; display: block; }';
    document.head.appendChild(style);
  }

  class HeapDiagramElement extends HTMLElement {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      injectPageStyles();

      const wrap = parseInt(this.getAttribute('wrap') || '128', 10);
      const start = parseStart(this.getAttribute('start'));
      const title = this.getAttribute('title') || '';
      const withLegend = this.hasAttribute('legend');
      let padSize = 0;
      if (this.hasAttribute('pad')) {
        const v = this.getAttribute('pad');
        padSize = v ? (parseInt(v, 10) || 8) : 8;
      }
      let sentinelSize = 0;
      if (this.hasAttribute('sentinel')) {
        const v = this.getAttribute('sentinel');
        sentinelSize = v ? (parseInt(v, 10) || 8) : 8;
      }
      const text = this.textContent;
      this.textContent = '';

      const blocks = parseBlocks(text);
      const rows = layoutHeap(blocks, wrap, start, padSize, sentinelSize);
      this.innerHTML = renderSVG(rows, wrap, title, withLegend, padSize > 0);

      const svg = this.querySelector('svg');
      if (svg) attachInteractivity(svg);
    }
  }

  if (!customElements.get('heap-diagram')) {
    customElements.define('heap-diagram', HeapDiagramElement);
  }
})();
