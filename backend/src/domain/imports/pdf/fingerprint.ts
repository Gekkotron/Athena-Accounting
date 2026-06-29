import { createHash } from 'node:crypto';
import type { PdfPageText } from './text-extract.js';
import type { ZoneRect } from './zones.js';

const HEADER_HEIGHT_RATIO = 0.15;

export function defaultHeaderZone(page: PdfPageText): ZoneRect {
  return {
    page: 0,
    x: 0,
    y: 0,
    w: page.widthPt,
    h: page.heightPt * HEADER_HEIGHT_RATIO,
  };
}

// Stable across statements from the same bank+layout:
// - strip digits (dates, account numbers, balances change month-to-month)
// - strip accents
// - lowercase
// - collapse all whitespace
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\d/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function itemsInZone(page: PdfPageText, zone: ZoneRect): string {
  return page.items
    .filter((it) => it.yTop >= zone.y && it.yTop <= zone.y + zone.h)
    .filter((it) => it.xLeft >= zone.x && it.xLeft <= zone.x + zone.w)
    .sort((a, b) => a.yTop - b.yTop || a.xLeft - b.xLeft)
    .map((it) => it.str)
    .join(' ');
}

export function fingerprintFromZone(page: PdfPageText, zone: ZoneRect): string {
  const joined = itemsInZone(page, zone);
  return createHash('sha256').update(normalize(joined)).digest('hex');
}

export function fingerprintHeader(page: PdfPageText): string {
  return fingerprintFromZone(page, defaultHeaderZone(page));
}
