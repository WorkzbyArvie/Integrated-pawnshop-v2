import Tesseract from 'tesseract.js';

export interface OcrResult {
  extractedName: string;
  extractedIdNumber: string;
  extractedText: string;
  confidence: number;
  nameMatches: boolean;
  idNumberMatches: boolean;
  philsysDetected: boolean;
  error?: string;
}

const NOISE_WORDS = new Set([
  'republic', 'philippines', 'philsys', 'national', 'id', 'identification',
  'date', 'birth', 'expiry', 'valid', 'until', 'sex', 'gender',
  'civil', 'status', 'blood', 'type', 'height', 'weight',
  'address', 'citizenship', 'issuer', 'authority', 'document',
  'control', 'number', 'series', 'commission', 'election',
  'philippine', 'statistics', 'office', 'card', 'certify',
  'las', 'pinas', 'city', 'province', 'region', 'dist',
  'serial', 'ref', 'page', 'form', 'copy', 'sni', 'ala',
  'filipino', 'filipina', 'single', 'married', 'widowed',
  'psn', 'pcn', 'psa', 'crs', 'barcode', 'qr',
]);

const FIELD_LABELS: Record<string, string[]> = {
  surname: ['surname', 'surnames', 'apelyido', 'last name', 'family name', 'cognomen', 'last'],
  given: ['given name', 'given names', 'first name', 'pangalan', 'unang pangalan', 'first'],
  middle: ['middle name', 'middle names', 'gitnang pangalan', 'middle'],
};

function normalizeForCompare(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLine(line: string): string {
  return line.replace(/[^A-Za-z .,'-]/g, '').trim();
}

function isNoiseWord(w: string): boolean {
  return NOISE_WORDS.has(w.toLowerCase()) || w.length < 2;
}

function tryLabeledFieldExtraction(text: string): { name: string; fields: Record<string, string> } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const found: Record<string, string> = {};

  const isFieldLabel = (line: string): boolean => {
    const lower = line.toLowerCase().trim();
    return Object.values(FIELD_LABELS).flat().some((l) => lower === l || lower.startsWith(l + ' ') || lower.endsWith(' ' + l));
  };

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase().trim();

    for (const [field, labels] of Object.entries(FIELD_LABELS)) {
      if (found[field]) continue;

      for (const label of labels) {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (lower === label || lower === escapedLabel) {
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLine = cleanLine(lines[j]);
            if (nextLine.length >= 2 && !isFieldLabel(lines[j])) {
              found[field] = nextLine;
              break;
            }
          }
          break;
        }

        if (lower.includes(label)) {
          const afterLabel = lower.split(new RegExp(escapedLabel, 'i'))[1]?.trim();
          const cleanedAfter = cleanLine(afterLabel || '');
          if (cleanedAfter.length >= 2 && !isFieldLabel(cleanedAfter)) {
            found[field] = cleanedAfter;
          } else {
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
              const nextLine = cleanLine(lines[j]);
              if (nextLine.length >= 2 && !isFieldLabel(lines[j])) {
                found[field] = nextLine;
                break;
              }
            }
          }
          break;
        }
      }
    }

    const colonMatch = lines[i].match(/^([A-Za-z /'.,-]{2,30}):\s*(.+)$/);
    if (colonMatch) {
      const label = colonMatch[1].toLowerCase().trim();
      const value = cleanLine(colonMatch[2]);
      if (value.length >= 2) {
        for (const [field, labels] of Object.entries(FIELD_LABELS)) {
          if (!found[field] && labels.some((l) => label.includes(l))) {
            found[field] = value;
          }
        }
      }
    }
  }

  const trimTrailingShort = (s: string): string => {
    const w = s.split(/\s+/);
    while (w.length > 2 && w[w.length - 1].length <= 2) w.pop();
    return w.join(' ');
  };

  for (const key of Object.keys(found)) {
    found[key] = trimTrailingShort(found[key]);
  }

  if (Object.keys(found).length >= 2) {
    const parts: string[] = [];
    if (found.given) parts.push(found.given);
    if (found.middle) parts.push(found.middle);
    if (found.surname) parts.push(found.surname);
    const fullName = parts.join(' ');
    if (fullName.split(' ').length >= 2 && fullName.length >= 5) {
      return { name: fullName, fields: found };
    }
  }

  if (Object.keys(found).length >= 1) {
    const parts: string[] = [];
    if (found.given) parts.push(found.given);
    if (found.middle) parts.push(found.middle);
    if (found.surname) parts.push(found.surname);
    const fullName = parts.join(' ').trim();
    if (fullName.length >= 3) {
      return { name: fullName, fields: found };
    }
  }

  return { name: '', fields: found };
}

function normalizeIdNumber(input: string): string {
  return input.replace(/[\s-]/g, '');
}

async function preprocessImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = Math.max(img.width, img.height);
      const targetDim = Math.max(4800, maxDim * 2);
      const scale = targetDim / maxDim;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      const grayArr = new Uint8Array(data.length / 4);
      for (let i = 0; i < data.length; i += 4) {
        grayArr[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }

      const w = canvas.width;
      const h = canvas.height;
      const sharpened = new Uint8Array(grayArr.length);
      const amount = 1.5;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          const center = grayArr[idx] * 5;
          const neighbors =
            grayArr[idx - 1] + grayArr[idx + 1] +
            grayArr[idx - w] + grayArr[idx + w];
          sharpened[idx] = Math.max(0, Math.min(255, Math.round(grayArr[idx] + (center - neighbors) * amount / 5)));
        }
      }

      let min = 255;
      let max = 0;
      for (const v of sharpened) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const range = max - min || 1;

      const histogram = new Uint32Array(256);
      for (const v of sharpened) histogram[v]++;

      let sumAll = 0;
      for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

      let sumB = 0;
      let wB = 0;
      let wF = 0;
      let maxVariance = 0;
      let otsuThreshold = 128;

      for (let t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB === 0) continue;
        wF = sharpened.length - wB;
        if (wF === 0) break;
        sumB += t * histogram[t];
        const mB = sumB / wB;
        const mF = (sumAll - sumB) / wF;
        const variance = wB * wF * (mB - mF) * (mB - mF);
        if (variance > maxVariance) {
          maxVariance = variance;
          otsuThreshold = t;
        }
      }

      for (let i = 0; i < data.length; i += 4) {
        const stretched = Math.round(((sharpened[i / 4] - min) / range) * 255);
        const bw = stretched >= otsuThreshold ? 255 : 0;
        data[i] = bw;
        data[i + 1] = bw;
        data[i + 2] = bw;
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Preprocessing failed'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load image for preprocessing'));
    img.src = URL.createObjectURL(file);
  });
}

function extractIdNumber(text: string): string {
  const patterns = [
    { re: /(?:PSN|PSO|PCN|ID\s*(?:No|Number|No\.))\s*[:.]?\s*(\d[\d\s-]{8,20}\d)/i, priority: 1 },
    { re: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{0,4})\b/, priority: 2 },
    { re: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/, priority: 3 },
    { re: /\b(\d{12,16})\b/, priority: 4 },
    { re: /\b(\d[\d\s-]{10,20}\d)\b/, priority: 5 },
  ];

  const candidates: Array<{ raw: string; digits: string; priority: number; len: number }> = [];

  for (const { re, priority } of patterns) {
    const matches = text.matchAll(new RegExp(re.source, re.flags + 'g'));
    for (const match of matches) {
      if (match?.[1]) {
        const digits = normalizeIdNumber(match[1]);
        if (/^\d+$/.test(digits) && digits.length >= 10 && digits.length <= 18) {
          candidates.push({ raw: match[1].trim(), digits, priority, len: digits.length });
        }
      }
    }
  }

  if (candidates.length === 0) return '';

  const idealLens = new Set([12, 16]);
  candidates.sort((a, b) => {
    const aIdeal = idealLens.has(a.len) ? 0 : Math.abs(a.len - 12);
    const bIdeal = idealLens.has(b.len) ? 0 : Math.abs(b.len - 12);
    if (aIdeal !== bIdeal) return aIdeal - bIdeal;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.len - a.len;
  });

  let best = candidates[0];

  if (best.len >= 10 && best.len < 12) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let matchLineIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const lineDigits = lines[i].replace(/[^\d]/g, '');
      if (lineDigits.includes(best.digits)) {
        matchLineIdx = i;
        const idx = lineDigits.indexOf(best.digits);
        const remaining = lineDigits.substring(idx + best.len);
        if (remaining.length > 0) {
          const extra = remaining.substring(0, 12 - best.len);
          best = { raw: best.digits + extra, digits: best.digits + extra, priority: best.priority, len: best.len + extra.length };
        }
        break;
      }
    }

    if (best.len < 12 && matchLineIdx >= 0) {
      let extraDigits = '';
      for (let j = matchLineIdx + 1; j < Math.min(matchLineIdx + 6, lines.length); j++) {
        const nextLineDigits = lines[j].replace(/[^\d]/g, '');
        if (/^\d{1,8}$/.test(nextLineDigits) && nextLineDigits.length <= 8) {
          extraDigits += nextLineDigits;
        }
        if (best.len + extraDigits.length >= 12) break;
      }
      if (extraDigits.length > 0) {
        const extra = extraDigits.substring(0, 12 - best.len);
        best = { raw: best.digits + extra, digits: best.digits + extra, priority: best.priority, len: best.len + extra.length };
      }
    }

    if (best.len < 12) {
      for (let i = 0; i < lines.length; i++) {
        const lineDigits = lines[i].replace(/[^\d]/g, '');
        if (lineDigits.length >= 4 && best.digits.startsWith(lineDigits) && lineDigits.length < best.len) {
          let combined = lineDigits;
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const nd = lines[j].replace(/[^\d]/g, '');
            if (/^\d{1,8}$/.test(nd)) combined += nd;
            if (combined.length >= 12) break;
          }
          if (combined.length > best.len) {
            best = { raw: combined, digits: combined, priority: best.priority, len: combined.length };
          }
          break;
        }
      }
    }

    if (best.len < 12) {
      const allDigitRuns = text.match(/\d{3,}/g) || [];
      const nearDigits = allDigitRuns.filter((run) => best.digits.includes(run) || run.includes(best.digits.substring(best.len - Math.min(4, best.len))));
      const extraFromText = nearDigits.join('');
      const pos = extraFromText.indexOf(best.digits);
      if (pos >= 0) {
        const remaining = extraFromText.substring(pos + best.len);
        if (remaining.length > 0) {
          const extra = remaining.substring(0, 12 - best.len);
          best = { raw: best.digits + extra, digits: best.digits + extra, priority: best.priority, len: best.len + extra.length };
        }
      }
    }
  }

  return best.raw;
}

function scoreCandidate(line: string, lineIndex: number, totalLines: number): number {
  let score = 0;
  const cleaned = cleanLine(line);
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1);

  if (words.length >= 2 && words.length <= 4) score += 40;
  else if (words.length === 5) score += 15;
  else score -= 10;

  const nonNoise = words.filter((w) => !isNoiseWord(w));
  const noiseRatio = 1 - nonNoise.length / words.length;
  score += Math.round(nonNoise.length * 15);
  score -= Math.round(noiseRatio * 30);

  const positionRatio = totalLines > 0 ? lineIndex / totalLines : 0.5;
  if (positionRatio >= 0.15 && positionRatio <= 0.55) score += 25;
  else if (positionRatio >= 0.1 && positionRatio <= 0.65) score += 10;
  else score -= 10;

  if (cleaned.length >= 8 && cleaned.length <= 35) score += 20;
  else if (cleaned.length < 5 || cleaned.length > 50) score -= 15;

  const allUpper = words.every((w) => /^[A-Z]/.test(w));
  if (allUpper) score += 15;

  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  if (avgWordLen >= 3 && avgWordLen <= 8) score += 10;

  return score;
}

function tryLineScoring(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const SKIP_PATTERNS = /^[\s]*(republic|philippines|philsys|national|id\b|identification|certificate|birth|death|marriage|clearance|license|commission|election|statistics|authority|office|address|citizenship|civil|status|blood|date|expiry|valid|sex|gender|height|weight|serial|ref|page|form|copy|certify|united|states|america|sni|ala|pinas|city|province|region|dist|card|surname|given|middle|filipino|filipina|single|married|psn|pcn|psa|barcode|last|first|family|name\b)/i;
  const NUMBER_PATTERN = /\d{2,}/;

  const candidates: Array<{ line: string; score: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleaned = cleanLine(line);

    if (cleaned.length < 5 || cleaned.length > 60) continue;
    if (SKIP_PATTERNS.test(cleaned)) continue;
    if (NUMBER_PATTERN.test(cleaned)) continue;

    let words = cleaned.split(/\s+/).filter((w) => w.length > 1);
    if (words.length < 2 || words.length > 6) continue;

    while (words.length > 2 && words[words.length - 1].length <= 2) {
      words.pop();
    }

    const trimmed = words.join(' ');
    const nonNoise = words.filter((w) => !isNoiseWord(w));
    if (nonNoise.length < 2) continue;

    const alphaChars = cleaned.replace(/[^A-Za-z]/g, '').length;
    const totalChars = cleaned.replace(/\s/g, '').length;
    if (totalChars === 0 || alphaChars / totalChars < 0.8) continue;

    const score = scoreCandidate(trimmed, i, lines.length);
    candidates.push({ line: trimmed, score });
  }

  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].line;
}

function extractNameFromText(text: string): string {
  const labeled = tryLabeledFieldExtraction(text);
  if (labeled.name) return labeled.name;

  const scored = tryLineScoring(text);
  if (scored) return scored;

  return '';
}

function namesMatch(inputName: string, ocrName: string): boolean {
  const a = normalizeForCompare(inputName);
  const b = normalizeForCompare(ocrName);

  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const aAlpha = a.replace(/\s+/g, '');
  const bAlpha = b.replace(/\s+/g, '');
  if (aAlpha === bAlpha) return true;

  const aParts = a.split(' ').filter((p) => p.length >= 2);
  const bParts = b.split(' ').filter((p) => p.length >= 2);

  if (aParts.length === 0 || bParts.length === 0) return false;

  let matches = 0;
  for (const part of aParts) {
    for (const bPart of bParts) {
      if (
        part === bPart ||
        (part.length >= 3 && bPart.length >= 3 &&
          (part.startsWith(bPart) || bPart.startsWith(part)))
      ) {
        matches++;
        break;
      }
    }
  }

  return matches / aParts.length >= 0.5;
}

function idNumbersMatch(inputId: string, ocrId: string): boolean {
  const a = normalizeIdNumber(inputId);
  const b = normalizeIdNumber(ocrId);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  if (longer.startsWith(shorter)) return true;

  let diff = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) diff++;
  }
  diff += longer.length - shorter.length;

  return diff <= 2;
}

export function recompareOcr(inputName: string, inputIdNumber: string, ocrExtractedName: string, ocrExtractedIdNumber: string): { nameMatches: boolean; idNumberMatches: boolean } {
  return {
    nameMatches: namesMatch(inputName, ocrExtractedName),
    idNumberMatches: idNumbersMatch(inputIdNumber, ocrExtractedIdNumber),
  };
}

const PHILSYS_MARKERS = [
  'philsys', 'philippine identification', 'national id', 'republic of the philippines',
  'psn', 'pcn', 'philippine statistics authority', 'psa',
  'card number', 'personal ref', 'philsys card',
  'republic', 'philippines', 'identification',
];

function detectPhilSys(text: string): boolean {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const fuzzy = lower.replace(/[0-9]/g, (d) => {
    const map: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };
    return map[d] || d;
  });
  const combined = lower + ' ' + fuzzy;

  let matchCount = 0;
  for (const marker of PHILSYS_MARKERS) {
    if (combined.includes(marker)) matchCount++;
  }

  if (matchCount >= 1) return true;

  const words = combined.split(/\s+/);
  const philsysHits = words.filter((w) => /^(ph|i[dl]|sys|id)$/.test(w) || w.startsWith('phil'));
  if (philsysHits.length >= 2) return true;

  const hasRepublic = combined.includes('republic');
  const hasPhilippines = combined.includes('philippines');
  if (hasRepublic && hasPhilippines) return true;

  return false;
}

export async function scanIdImage(
  imageFile: File,
  inputFullName: string,
  inputIdNumber: string,
): Promise<OcrResult> {
  try {
    const preprocessed = await preprocessImage(imageFile);
    const { data } = await Tesseract.recognize(preprocessed, 'eng+fil', {
      logger: () => {},
    });

    const extractedText = data.text;
    const confidence = data.confidence;
    const extractedName = extractNameFromText(extractedText);
    const nameMatches = namesMatch(inputFullName, extractedName);
    const extractedIdNumber = extractIdNumber(extractedText);
    const idNumberMatches = idNumbersMatch(inputIdNumber, extractedIdNumber);
    const philsysDetected = detectPhilSys(extractedText);

    return {
      extractedName,
      extractedIdNumber,
      extractedText,
      confidence,
      nameMatches,
      idNumberMatches,
      philsysDetected,
    };
  } catch (err: any) {
    return {
      extractedName: '',
      extractedIdNumber: '',
      extractedText: '',
      confidence: 0,
      nameMatches: false,
      idNumberMatches: false,
      philsysDetected: false,
      error: err.message || 'OCR scanning failed',
    };
  }
}
