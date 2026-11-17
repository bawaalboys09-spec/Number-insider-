import * as cheerio from 'cheerio';
import {
  extractEmailsFromText,
  extractPhonesFromText,
  extractWhatsAppPhoneFromHref,
  isLikelyNonPhoneContext,
  normalizeIndianPhone,
  normalizeUrl,
  type NormalizedPhone,
} from './phoneUtils.ts';

export interface CrawledContactItem {
  phone: NormalizedPhone;
  sourceUrl: string;
  sourceWebsite: string;
  contextSnippet: string;
  viaTelLink: boolean;
  isPrincipalOrOffice: 'principal' | 'office' | 'general';
}

export interface WebsiteCrawlResult {
  websiteUrl: string;
  visitedUrls: string[];
  contacts: CrawledContactItem[];
  emails: { email: string; sourceUrl: string }[];
  addressSnippets: string[];
  blockedByRobots: boolean;
  errors: string[];
}

const USER_AGENT = 'SchoolContactFinderAI/1.0 (+https://schoolcontactfinder.local)';
const robotsCache = new Map<string, { disallow: string[]; fetchedAt: number }>();
const unreachableHostCache = new Map<string, { failures: number; until: number }>();

function isHostMarkedUnreachable(host: string): boolean {
  const entry = unreachableHostCache.get(host);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    unreachableHostCache.delete(host);
    return false;
  }
  return entry.failures >= 2;
}

function recordHostFailure(host: string) {
  const entry = unreachableHostCache.get(host);
  const failures = (entry?.failures || 0) + 1;
  unreachableHostCache.set(host, {
    failures,
    until: Date.now() + 1000 * 60 * 10,
  });
}

function clearHostFailure(host: string) {
  unreachableHostCache.delete(host);
}

async function fetchWithTimeout(url: string, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getDisallowedPaths(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < 1000 * 60 * 30) {
    return cached.disallow;
  }

  const disallow: string[] = [];
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, 1500);
    if (res.ok) {
      const text = await res.text();
      let activeForAll = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.split('#')[0].trim();
        if (!line) continue;
        const lower = line.toLowerCase();
        if (lower.startsWith('user-agent:')) {
          const agent = line.slice('user-agent:'.length).trim();
          activeForAll = agent === '*' || agent.toLowerCase().includes('schoolcontactfinder');
        } else if (activeForAll && lower.startsWith('disallow:')) {
          const path = line.slice('disallow:'.length).trim();
          if (path) disallow.push(path);
        }
      }
    }
  } catch {
    // robots.txt unavailable -> proceed carefully
  }

  robotsCache.set(origin, { disallow, fetchedAt: Date.now() });
  return disallow;
}

function isAllowedByRobots(pathname: string, disallowRules: string[]): boolean {
  for (const rule of disallowRules) {
    if (rule === '/') return false;
    if (pathname.startsWith(rule)) return false;
  }
  return true;
}

function detectRoleFromSnippet(snippet: string): 'principal' | 'office' | 'general' {
  const lower = snippet.toLowerCase();
  if (lower.includes('principal') || lower.includes('headmaster') || lower.includes('director')) {
    return 'principal';
  }
  if (lower.includes('office') || lower.includes('admission') || lower.includes('reception') || lower.includes('helpdesk')) {
    return 'office';
  }
  return 'general';
}

function isCaptchaOrLoginWall(html: string, status: number): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  const lower = html.slice(0, 6000).toLowerCase();
  if (
    lower.includes('cf-browser-verification') ||
    lower.includes('attention required! | cloudflare') ||
    lower.includes('g-recaptcha') ||
    lower.includes('hcaptcha')
  ) {
    return true;
  }
  return false;
}

export async function crawlOfficialWebsite(rawWebsiteUrl: string): Promise<WebsiteCrawlResult> {
  const normalizedRoot = normalizeUrl(rawWebsiteUrl);
  if (!normalizedRoot) {
    return {
      websiteUrl: rawWebsiteUrl,
      visitedUrls: [],
      contacts: [],
      emails: [],
      addressSnippets: [],
      blockedByRobots: false,
      errors: ['Invalid website URL'],
    };
  }

  const rootUrlObj = new URL(normalizedRoot);
  const origin = rootUrlObj.origin;
  const host = rootUrlObj.hostname;

  if (isHostMarkedUnreachable(host)) {
    return {
      websiteUrl: normalizedRoot,
      visitedUrls: [],
      contacts: [],
      emails: [],
      addressSnippets: [],
      blockedByRobots: false,
      errors: [`Skipped temporarily unreachable host ${host}`],
    };
  }

  const disallowRules = await getDisallowedPaths(origin);
  const visitedUrls: string[] = [];
  const contactsMap = new Map<string, CrawledContactItem>();
  const emailsMap = new Map<string, { email: string; sourceUrl: string }>();
  const addressSnippets: string[] = [];
  const errors: string[] = [];
  let blockedByRobots = false;

  const candidatePages = new Set<string>([normalizedRoot]);

  const scrapePage = async (pageUrl: string, discoverLinks: boolean) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(pageUrl);
    } catch {
      return;
    }

    if (!isAllowedByRobots(parsedUrl.pathname, disallowRules)) {
      if (pageUrl === normalizedRoot) blockedByRobots = true;
      return;
    }

    try {
      const res = await fetchWithTimeout(pageUrl, 3500);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return;
      }

      const html = await res.text();
      if (isCaptchaOrLoginWall(html, res.status)) {
        errors.push(`Access restricted or CAPTCHA on ${pageUrl} (HTTP ${res.status})`);
        return;
      }

      clearHostFailure(host);
      visitedUrls.push(pageUrl);
      const $ = cheerio.load(html);

      // Extract JSON-LD structured data (telephone, email, contactPoint) BEFORE removing <script> tags
      $('script[type="application/ld+json"]').each((_, el) => {
        const jsonText = $(el).html() || '';
        if (!jsonText) return;
        for (const p of extractPhonesFromText(jsonText)) {
          if (!contactsMap.has(p.canonicalDigits)) {
            contactsMap.set(p.canonicalDigits, {
              phone: p,
              sourceUrl: pageUrl,
              sourceWebsite: host,
              contextSnippet: 'Schema.org JSON-LD structured contact',
              viaTelLink: true,
              isPrincipalOrOffice: 'office',
            });
          }
        }
        for (const e of extractEmailsFromText(jsonText)) {
          if (!emailsMap.has(e)) {
            emailsMap.set(e, { email: e, sourceUrl: pageUrl });
          }
        }
      });

      $('script, style, noscript, svg').remove();

      $('a[href^="tel:"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const rawNumber = href.replace(/^tel:/i, '').trim();
        const normalized = normalizeIndianPhone(rawNumber);
        const parentText = $(el).parent().text().replace(/\s+/g, ' ').trim().slice(0, 180);
        if (normalized && !contactsMap.has(normalized.canonicalDigits)) {
          contactsMap.set(normalized.canonicalDigits, {
            phone: normalized,
            sourceUrl: pageUrl,
            sourceWebsite: host,
            contextSnippet: parentText || $(el).text().trim(),
            viaTelLink: true,
            isPrincipalOrOffice: detectRoleFromSnippet(parentText),
          });
        }
      });

      $('a[href*="wa.me/"], a[href*="whatsapp.com/send"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const normalized = extractWhatsAppPhoneFromHref(href);
        const parentText = $(el).parent().text().replace(/\s+/g, ' ').trim().slice(0, 180);
        if (normalized && !contactsMap.has(normalized.canonicalDigits)) {
          contactsMap.set(normalized.canonicalDigits, {
            phone: normalized,
            sourceUrl: pageUrl,
            sourceWebsite: host,
            contextSnippet: parentText ? `WhatsApp: ${parentText}` : 'Official WhatsApp Contact Link',
            viaTelLink: true,
            isPrincipalOrOffice: detectRoleFromSnippet(parentText),
          });
        }
      });

      $('a[href^="mailto:"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const email = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
        if (email && email.includes('@') && !emailsMap.has(email)) {
          emailsMap.set(email, { email, sourceUrl: pageUrl });
        }
      });

      const prioritySelectors = ['footer', 'address', '.contact', '#contact', '.footer', 'header', 'main', 'body'];
      for (const selector of prioritySelectors) {
        $(selector).each((_, el) => {
          const blockText = $(el).text().replace(/\s+/g, ' ').trim();
          if (!blockText) return;

          if (selector === 'address' || blockText.toLowerCase().includes('pin') || blockText.toLowerCase().includes('dist')) {
            if (blockText.length > 15 && blockText.length < 300 && addressSnippets.length < 4) {
              addressSnippets.push(blockText);
            }
          }

          const phones = extractPhonesFromText(blockText);
          for (const p of phones) {
            if (!contactsMap.has(p.canonicalDigits)) {
              const idx = blockText.search(new RegExp(p.canonicalDigits.slice(-5)));
              const snippet =
                idx >= 0
                  ? blockText.slice(Math.max(0, idx - 60), Math.min(blockText.length, idx + 80))
                  : blockText.slice(0, 140);

              if (isLikelyNonPhoneContext(snippet)) continue;

              contactsMap.set(p.canonicalDigits, {
                phone: p,
                sourceUrl: pageUrl,
                sourceWebsite: host,
                contextSnippet: snippet,
                viaTelLink: false,
                isPrincipalOrOffice: detectRoleFromSnippet(snippet),
              });
            }
          }

          const emails = extractEmailsFromText(blockText);
          for (const e of emails) {
            if (!emailsMap.has(e)) {
              emailsMap.set(e, { email: e, sourceUrl: pageUrl });
            }
          }
        });
      }

      if (discoverLinks) {
        const priorityKeywords = [
          'contact',
          'reach',
          'about',
          'disclosure',
          'mandatory',
          'principal',
          'enquiry',
        ];
        $('a[href]').each((_, el) => {
          if (candidatePages.size >= 4) return;
          const href = $(el).attr('href') || '';
          const linkText = $(el).text().toLowerCase();
          const combined = `${href.toLowerCase()} ${linkText}`;
          if (!priorityKeywords.some((k) => combined.includes(k))) return;

          try {
            const abs = new URL(href, pageUrl);
            if (abs.origin === origin && !abs.pathname.match(/\.(pdf|jpg|png|docx?|xlsx?)$/i)) {
              candidatePages.add(abs.toString());
            }
          } catch {
            // ignore invalid href
          }
        });
      }
    } catch (err) {
      errors.push(
        `Failed to fetch ${pageUrl}: ${err instanceof Error ? err.message : 'Network timeout'}`
      );
    }
  };

  await scrapePage(normalizedRoot, true);

  // If https:// root failed due to TLS/SSL error on older Indian school websites, retry once over http://
  if (visitedUrls.length === 0 && !blockedByRobots && normalizedRoot.startsWith('https://')) {
    const httpFallback = normalizedRoot.replace(/^https:\/\//i, 'http://');
    await scrapePage(httpFallback, true);
  }

  // If homepage itself was unreachable/failed without visiting any URL, skip subpage fetches on the same dead host!
  if (visitedUrls.length === 0) {
    if (!blockedByRobots) recordHostFailure(host);
    return {
      websiteUrl: normalizedRoot,
      visitedUrls,
      contacts: [],
      emails: [],
      addressSnippets: [],
      blockedByRobots,
      errors,
    };
  }

  if (candidatePages.size === 1) {
    candidatePages.add(`${origin}/contact`);
    candidatePages.add(`${origin}/contact-us`);
  }

  const subPages = Array.from(candidatePages).filter((u) => u !== normalizedRoot);
  if (subPages.length > 0 && !(contactsMap.size >= 2 && emailsMap.size >= 1)) {
    const pagesToFetch = contactsMap.size >= 1 ? subPages.slice(0, 2) : subPages.slice(0, 3);
    await Promise.all(pagesToFetch.map((url) => scrapePage(url, false)));
  }

  return {
    websiteUrl: normalizedRoot,
    visitedUrls,
    contacts: Array.from(contactsMap.values()),
    emails: Array.from(emailsMap.values()),
    addressSnippets,
    blockedByRobots,
    errors,
  };
}

export async function crawlSinglePage(rawPageUrl: string): Promise<WebsiteCrawlResult> {
  const normalizedUrl = normalizeUrl(rawPageUrl);
  if (!normalizedUrl) {
    return {
      websiteUrl: rawPageUrl,
      visitedUrls: [],
      contacts: [],
      emails: [],
      addressSnippets: [],
      blockedByRobots: false,
      errors: ['Invalid URL'],
    };
  }

  const parsed = new URL(normalizedUrl);
  const host = parsed.hostname;
  if (isHostMarkedUnreachable(host)) {
    return {
      websiteUrl: normalizedUrl,
      visitedUrls: [],
      contacts: [],
      emails: [],
      addressSnippets: [],
      blockedByRobots: false,
      errors: [],
    };
  }

  const contactsMap = new Map<string, CrawledContactItem>();
  const emailsMap = new Map<string, { email: string; sourceUrl: string }>();
  const errors: string[] = [];

  try {
    const res = await fetchWithTimeout(normalizedUrl, 3000);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return {
        websiteUrl: normalizedUrl,
        visitedUrls: [],
        contacts: [],
        emails: [],
        addressSnippets: [],
        blockedByRobots: false,
        errors: [],
      };
    }

    const html = await res.text();
    if (isCaptchaOrLoginWall(html, res.status)) {
      return {
        websiteUrl: normalizedUrl,
        visitedUrls: [],
        contacts: [],
        emails: [],
        addressSnippets: [],
        blockedByRobots: false,
        errors: [`Access restricted on ${normalizedUrl} (HTTP ${res.status})`],
      };
    }

    clearHostFailure(host);
    const $ = cheerio.load(html);

    $('script[type="application/ld+json"]').each((_, el) => {
      const jsonText = $(el).html() || '';
      if (!jsonText) return;
      for (const p of extractPhonesFromText(jsonText)) {
        if (!contactsMap.has(p.canonicalDigits)) {
          contactsMap.set(p.canonicalDigits, {
            phone: p,
            sourceUrl: normalizedUrl,
            sourceWebsite: host,
            contextSnippet: 'Schema.org JSON-LD structured contact',
            viaTelLink: true,
            isPrincipalOrOffice: 'office',
          });
        }
      }
      for (const e of extractEmailsFromText(jsonText)) {
        if (!emailsMap.has(e)) {
          emailsMap.set(e, { email: e, sourceUrl: normalizedUrl });
        }
      }
    });

    $('script, style, noscript, svg').remove();

    $('a[href^="tel:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const normalized = normalizeIndianPhone(href.replace(/^tel:/i, '').trim());
      if (normalized && !contactsMap.has(normalized.canonicalDigits)) {
        contactsMap.set(normalized.canonicalDigits, {
          phone: normalized,
          sourceUrl: normalizedUrl,
          sourceWebsite: host,
          contextSnippet: $(el).parent().text().replace(/\s+/g, ' ').trim().slice(0, 160),
          viaTelLink: true,
          isPrincipalOrOffice: detectRoleFromSnippet($(el).parent().text()),
        });
      }
    });

    $('a[href*="wa.me/"], a[href*="whatsapp.com/send"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const normalized = extractWhatsAppPhoneFromHref(href);
      if (normalized && !contactsMap.has(normalized.canonicalDigits)) {
        contactsMap.set(normalized.canonicalDigits, {
          phone: normalized,
          sourceUrl: normalizedUrl,
          sourceWebsite: host,
          contextSnippet: 'Official WhatsApp link',
          viaTelLink: true,
          isPrincipalOrOffice: 'office',
        });
      }
    });

    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (email && email.includes('@') && !emailsMap.has(email)) {
        emailsMap.set(email, { email, sourceUrl: normalizedUrl });
      }
    });

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    for (const p of extractPhonesFromText(bodyText)) {
      if (!contactsMap.has(p.canonicalDigits)) {
        const idx = bodyText.search(new RegExp(p.canonicalDigits.slice(-5)));
        const snippet =
          idx >= 0
            ? bodyText.slice(Math.max(0, idx - 60), Math.min(bodyText.length, idx + 80))
            : bodyText.slice(0, 160);
        if (isLikelyNonPhoneContext(snippet)) continue;
        contactsMap.set(p.canonicalDigits, {
          phone: p,
          sourceUrl: normalizedUrl,
          sourceWebsite: host,
          contextSnippet: snippet,
          viaTelLink: false,
          isPrincipalOrOffice: 'office',
        });
      }
    }
    for (const e of extractEmailsFromText(bodyText)) {
      if (!emailsMap.has(e)) {
        emailsMap.set(e, { email: e, sourceUrl: normalizedUrl });
      }
    }

    return {
      websiteUrl: normalizedUrl,
      visitedUrls: [normalizedUrl],
      contacts: Array.from(contactsMap.values()),
      emails: Array.from(emailsMap.values()),
      addressSnippets: [],
      blockedByRobots: false,
      errors,
    };
  } catch (err) {
    recordHostFailure(host);
    return {
      websiteUrl: normalizedUrl,
      visitedUrls: [],
      contacts: [],
      emails: [],
      addressSnippets: [],
      blockedByRobots: false,
      errors: [err instanceof Error ? err.message : 'Fetch failed'],
    };
  }
}
