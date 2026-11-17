import type { PhoneType } from '../src/types/school.ts';

export interface NormalizedPhone {
  formatted: string;
  canonicalDigits: string;
  phoneType: PhoneType;
}

const JUNK_SEQUENCES = new Set([
  '0000000000',
  '1111111111',
  '2222222222',
  '3333333333',
  '4444444444',
  '5555555555',
  '6666666666',
  '7777777777',
  '8888888888',
  '9999999999',
  '1234567890',
  '0123456789',
  '9876543210',
]);

export function normalizeIndianPhone(raw: string): NormalizedPhone | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\u00A0/g, ' ').trim();
  const digitsOnly = trimmed.replace(/[^\d]/g, '');

  if (digitsOnly.length < 10 || digitsOnly.length > 13) {
    return null;
  }

  // Toll-free numbers (1800 / 1860)
  if (/^(?:0)?(1800|1860)\d{6,7}$/.test(digitsOnly)) {
    const core = digitsOnly.startsWith('0') ? digitsOnly.slice(1) : digitsOnly;
    return {
      formatted: `${core.slice(0, 4)}-${core.slice(4)}`,
      canonicalDigits: core,
      phoneType: 'tollfree',
    };
  }

  // Detect explicit Indian STD landline formatting FIRST (e.g. 06115-227265, (0612) 2234567, 0612 2234567)
  // Indian STD codes start with 0 and have 2-4 area digits followed by a separator and 6-8 subscriber digits.
  const stdPatternMatch = trimmed.match(/^\(?0(\d{2,4})\)?[\s./-]+(\d{5,8})$/);
  if (stdPatternMatch) {
    const stdCode = '0' + stdPatternMatch[1];
    const subscriber = stdPatternMatch[2];
    const combined = stdCode + subscriber;
    if (
      (combined.length === 10 || combined.length === 11) &&
      !JUNK_SEQUENCES.has(subscriber) &&
      !/(\d)\1{6,}/.test(subscriber)
    ) {
      return {
        formatted: `${stdCode}-${subscriber}`,
        canonicalDigits: combined,
        phoneType: 'landline',
      };
    }
  }

  // Check Indian 10-digit mobile number (with optional +91, 91, or 0 prefix)
  let mobileCandidate = digitsOnly;
  let hadZeroPrefix = false;
  if (mobileCandidate.length === 12 && mobileCandidate.startsWith('91')) {
    mobileCandidate = mobileCandidate.slice(2);
  } else if (mobileCandidate.length === 11 && mobileCandidate.startsWith('0')) {
    hadZeroPrefix = true;
    mobileCandidate = mobileCandidate.slice(1);
  }

  // If raw started with 06.. or 01..05 (Indian landline prefixes; 06115/0612/0621/0631 etc.), treat 06.. as landline unless formatted as mobile (+91 / 10 digits)
  const looksLikeBiharOrEastLandline = hadZeroPrefix && /^[1-6]/.test(mobileCandidate);

  if (!looksLikeBiharOrEastLandline && mobileCandidate.length === 10 && /^[6-9]\d{9}$/.test(mobileCandidate)) {
    if (JUNK_SEQUENCES.has(mobileCandidate)) return null;
    if (/(\d)\1{7,}/.test(mobileCandidate)) return null;
    return {
      formatted: `+91 ${mobileCandidate.slice(0, 5)} ${mobileCandidate.slice(5)}`,
      canonicalDigits: mobileCandidate,
      phoneType: 'mobile',
    };
  }

  // Fallback Indian landline check (STD code + subscriber number = 10 or 11 digits with leading 0)
  // Note: Only accept 10-digit numbers without leading 0 if explicitly prefixed with +91/91 or STD separator;
  // otherwise random 10-digit IDs / timestamps / UDISE numbers starting with 1-5 would create false positives.
  let landlineDigits = digitsOnly;
  if (landlineDigits.length === 12 && landlineDigits.startsWith('91')) {
    landlineDigits = '0' + landlineDigits.slice(2);
  }

  if ((landlineDigits.length === 10 || landlineDigits.length === 11) && landlineDigits.startsWith('0')) {
    const subscriber = landlineDigits.slice(1);
    if (JUNK_SEQUENCES.has(subscriber) || /(\d)\1{6,}/.test(subscriber)) return null;
    // Reject obvious placeholder/invalid STD codes like 00...
    if (landlineDigits.startsWith('00')) return null;
    const twoDigitArea = ['011', '020', '022', '033', '040', '044', '079', '080'];
    if (twoDigitArea.includes(landlineDigits.slice(0, 3))) {
      return {
        formatted: `${landlineDigits.slice(0, 3)}-${landlineDigits.slice(3)}`,
        canonicalDigits: landlineDigits,
        phoneType: 'landline',
      };
    }
    const stdLen =
      landlineDigits.startsWith('0611') ||
      landlineDigits.startsWith('0622') ||
      landlineDigits.startsWith('0624') ||
      landlineDigits.startsWith('0645')
        ? 5
        : 4;
    return {
      formatted: `${landlineDigits.slice(0, stdLen)}-${landlineDigits.slice(stdLen)}`,
      canonicalDigits: landlineDigits,
      phoneType: 'landline',
    };
  }

  return null;
}

export function isLikelyNonPhoneContext(snippet: string): boolean {
  const lower = snippet.toLowerCase();
  const hasExplicitPhoneWord =
    /\b(phone|ph\.?|tel|telephone|mobile|mob\.?|cell|contact|call|helpline|whatsapp|office|principal)\b/.test(
      lower
    );
  if (hasExplicitPhoneWord) return false;
  return /\b(udise|dise|affiliation|school code|reg\.?\s*no|registration|gstin|ifsc|account\s*no|aadhaar|pan\s*no|cbse\s*code)\b/.test(
    lower
  );
}

export function extractWhatsAppPhoneFromHref(href: string): NormalizedPhone | null {
  if (!href) return null;
  const waMatch = href.match(/(?:wa\.me\/|whatsapp\.com\/send\?[^#]*phone=)(\+?\d{10,13})/i);
  if (!waMatch) return null;
  return normalizeIndianPhone(waMatch[1]);
}

export function extractPhonesFromText(text: string): NormalizedPhone[] {
  if (!text) return [];
  const results = new Map<string, NormalizedPhone>();

  const regex =
    /(?<!\d)(?:\+?91[\s().-]*)?(?:\(?0\d{2,4}\)?[\s./-]*\d{5,8}|[6-9]\d{4}[\s.-]?\d{5}|1800[\s.-]?\d{3}[\s.-]?\d{3,4})(?!\d)/g;
  const matches = text.match(regex) ?? [];

  for (const rawMatch of matches) {
    const normalized = normalizeIndianPhone(rawMatch);
    if (normalized && !results.has(normalized.canonicalDigits)) {
      results.set(normalized.canonicalDigits, normalized);
    }
  }

  return Array.from(results.values());
}

export function extractEmailsFromText(text: string): string[] {
  if (!text) return [];
  // Normalize common Indian school website obfuscations like [at] and [dot]
  const deobfuscated = text
    .replace(/\s*\[at\]\s*|\s*\(at\)\s*/gi, '@')
    .replace(/\s*\[dot\]\s*|\s*\(dot\)\s*/gi, '.');

  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = deobfuscated.match(regex) ?? [];
  const ignoredDomains = [
    'example.com',
    'sentry.io',
    'wixpress.com',
    'wix.com',
    'domain.com',
    'email.com',
    'facebook.com',
    'justdial.com',
    'sulekha.com',
    'schools.org.in',
  ];
  const ignoredLocalPrefixes = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon'];
  const ignoredExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js'];

  const unique = new Set<string>();
  for (const m of matches) {
    const lower = m.replace(/^[-_.]+|[-_.]+$/g, '').toLowerCase();
    if (!lower.includes('@') || lower.startsWith('@')) continue;
    const [localPart] = lower.split('@');
    if (ignoredLocalPrefixes.some((p) => localPart === p)) continue;
    if (ignoredDomains.some((d) => lower.endsWith(d))) continue;
    if (ignoredExtensions.some((ext) => lower.endsWith(ext))) continue;
    unique.add(lower);
  }
  return Array.from(unique);
}

export function normalizeUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim().replace(/%20+$/g, '');
  if (!trimmed || trimmed.toLowerCase() === 'not found' || trimmed === '-' || trimmed.toLowerCase() === 'na') {
    return null;
  }
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProto);
    if (!parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
