import EXIF from 'exif-js';

const EDITING_SOFTWARE = [
  'photoshop', 'gimp', 'pixlr', 'canva', 'snapseed', 'lightroom',
  'paint.net', 'photopea', 'fotor', 'befunky', 'lunapic',
  'adobe', 'corel', 'affinity', 'capture one',
];

const SCREENSHOT_INDICATORS = [
  'screenshot', 'screen capture', 'snipping', 'grab',
];

export interface TamperCheckResult {
  clean: boolean;
  flags: string[];
  exifSoftware: string | null;
  imageWidth: number;
  imageHeight: number;
  suspiciousDimensions: boolean;
}

function detectEditingSoftware(software: string, make: string): string | null {
  const combined = `${software} ${make}`.toLowerCase();

  for (const editor of EDITING_SOFTWARE) {
    if (combined.includes(editor)) {
      return software || make || 'Unknown editor';
    }
  }

  for (const indicator of SCREENSHOT_INDICATORS) {
    if (combined.includes(indicator)) {
      return 'Screenshot detected';
    }
  }

  return null;
}

function checkSuspiciousDimensions(width: number, height: number): boolean {
  if (width < 300 || height < 200) return true;
  const ratio = width / height;
  if (ratio > 3 || ratio < 0.2) return true;
  const pixelCount = width * height;
  if (pixelCount > 50_000_000) return true;
  return false;
}

function detectImageFormat(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'webp';
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'heic';
  return 'unknown';
}

function checkImageConsistency(buffer: ArrayBuffer, format: string): string[] {
  const issues: string[] = [];
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 100) {
    issues.push('Image file is suspiciously small');
  }

  if (format === 'jpeg') {
    let markerCount = 0;
    for (let i = 0; i < Math.min(bytes.length - 1, 10000); i++) {
      if (bytes[i] === 0xff && bytes[i + 1] >= 0xc0 && bytes[i + 1] <= 0xfe) {
        markerCount++;
      }
    }
    if (markerCount > 20) {
      issues.push('Unusual number of JPEG markers — possible editing');
    }
  }

  if (format === 'unknown') {
    issues.push('Unrecognized image format');
  }

  return issues;
}

function readExif(file: File): Promise<{ software: string; make: string; model: string; dateTime: string; orientation: number; hasGps: boolean; hasCameraInfo: boolean }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        EXIF.getData(img as any, function (this: any) {
          const software = String(EXIF.getTag(this, 'Software') || '');
          const make = String(EXIF.getTag(this, 'Make') || '');
          const model = String(EXIF.getTag(this, 'Model') || '');
          const dateTime = String(EXIF.getTag(this, 'DateTimeOriginal') || EXIF.getTag(this, 'DateTime') || '');
          const orientation = Number(EXIF.getTag(this, 'Orientation') || 1);
          const lat = EXIF.getTag(this, 'GPSLatitude');
          const lng = EXIF.getTag(this, 'GPSLongitude');
          const hasGps = !!(lat && lng);
          const hasCameraInfo = !!(make || model || dateTime);
          resolve({ software, make, model, dateTime, orientation, hasGps, hasCameraInfo });
          URL.revokeObjectURL(img.src);
        });
      } catch {
        resolve({ software: '', make: '', model: '', dateTime: '', orientation: 1, hasGps: false, hasCameraInfo: false });
        URL.revokeObjectURL(img.src);
      }
    };
    img.onerror = () => resolve({ software: '', make: '', model: '', dateTime: '', orientation: 1, hasGps: false, hasCameraInfo: false });
    img.src = URL.createObjectURL(file);
  });
}

export async function checkImageTampering(file: File): Promise<TamperCheckResult> {
  const flags: string[] = [];
  let exifSoftware: string | null = null;
  let imageWidth = 0;
  let imageHeight = 0;

  const exif = await readExif(file);

  exifSoftware = detectEditingSoftware(exif.software, exif.make);
  if (exifSoftware) {
    flags.push(`Editing software detected: ${exifSoftware}`);
  }

  try {
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = URL.createObjectURL(file);
    });
    imageWidth = dims.width;
    imageHeight = dims.height;

    if (checkSuspiciousDimensions(imageWidth, imageHeight)) {
      flags.push('Suspicious image dimensions');
    }
  } catch {
    flags.push('Could not read image dimensions');
  }

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const format = detectImageFormat(bytes);
    const imageIssues = checkImageConsistency(buffer, format);
    flags.push(...imageIssues);
  } catch {
    // File read failed
  }

  return {
    clean: flags.length === 0,
    flags,
    exifSoftware,
    imageWidth,
    imageHeight,
    suspiciousDimensions: checkSuspiciousDimensions(imageWidth, imageHeight),
  };
}
