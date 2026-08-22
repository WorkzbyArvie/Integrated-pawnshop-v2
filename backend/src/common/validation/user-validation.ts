import { ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SUSPICIOUS_NAME_PATTERNS = [
  /^(test|fake|sample|dummy|john doe|jane doe|foo bar|asdf|qwerty)/i,
  /^(a{3,}|b{3,}|c{3,}|d{3,}|e{3,}|f{3,})\s/i,
];

export function normalizeEmail(input: string): string {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) {
    throw new BadRequestException('Email is required');
  }
  if (!EMAIL_REGEX.test(normalized)) {
    throw new BadRequestException('Invalid email format');
  }
  return normalized;
}

export function normalizeFullName(input: string): string {
  const normalized = String(input || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (normalized.length < 2 || normalized.length > 100) {
    throw new BadRequestException('Full name must be between 2 and 100 characters');
  }

  if (!/^[A-Za-z][A-Za-z .,'-]*$/.test(normalized)) {
    throw new BadRequestException('Full name contains invalid characters');
  }

  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 2) {
    throw new BadRequestException('Please enter your full legal name (first and last name)');
  }

  const lower = normalized.toLowerCase();
  for (const pattern of SUSPICIOUS_NAME_PATTERNS) {
    if (pattern.test(lower)) {
      throw new BadRequestException('Please enter your real full legal name');
    }
  }

  const uniqueChars = new Set(lower.replace(/\s/g, '')).size;
  if (uniqueChars < 4) {
    throw new BadRequestException('Name appears invalid. Please enter your full legal name');
  }

  return normalized;
}

export function normalizePhoneNumber(input: string): string {
  const raw = String(input || '').trim();

  if (/^\+639\d{9}$/.test(raw)) {
    return raw;
  }

  const digitsOnly = raw.replace(/\D+/g, '');
  if (/^09\d{9}$/.test(digitsOnly)) {
    return `+63${digitsOnly.slice(1)}`;
  }
  if (/^639\d{9}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }

  throw new BadRequestException('Phone number must be a valid PH mobile number (e.g., 09XXXXXXXXX)');
}

export async function assertEmailNotTaken(
  prisma: PrismaService,
  email: string,
  role?: string,
): Promise<void> {
  const where: Record<string, any> = { email };
  if (role) where.role = role;

  const existing = await prisma.profile.findFirst({
    where,
    select: { id: true, email: true, role: true },
  });

  if (existing) {
    const roleDesc = role ? ` with role ${role}` : '';
    throw new ConflictException(
      `An account with this email${roleDesc} already exists. Please use a different email or sign in.`,
    );
  }
}

export async function assertCustomerNotDuplicate(
  prisma: PrismaService,
  fullName: string,
  contactNumber: string,
  pawnshopId?: string | null,
): Promise<void> {
  const where: Record<string, any> = {
    fullName,
    contactNumber,
  };
  if (pawnshopId) {
    where.pawnshopId = pawnshopId;
  }

  const existing = await prisma.customer.findFirst({
    where,
    select: { id: true, fullName: true },
  });

  if (existing) {
    throw new ConflictException(
      `A customer named "${existing.fullName}" with this contact number already exists.`,
    );
  }
}
