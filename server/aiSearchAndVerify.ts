import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  EnrichedContactData,
  ExtractedContactCandidate,
  SchoolRecord,
  SearchSettings,
  SourceType,
  VerificationStatus,
} from '../src/types/school.ts';
import { crawlOfficialWebsite, crawlSinglePage, type WebsiteCrawlResult } from './crawler.ts';
import { searchGoogleMapsPlace, type MapsPlaceResult } from './mapsPlaces.ts';
import {
  extractEmailsFromText,
  extractPhonesFromText,
  isLikelyNonPhoneContext,
  normalizeIndianPhone,
  normalizeUrl,
} from './phoneUtils.ts';

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 0 && key !== 'MY_GEMINI_API_KEY');
}

interface GroundedSearchEvidence {
  summaryText: string;
  groundedUrls: Array<{ url: string; title: string }>;
  discoveredWebsites: string[];
  extractedPhones: Array<{
    formatted: string;
    canonicalDigits: string;
    phoneType: 'mobile' | 'landline' | 'tollfree' | 'unknown';
    snippet: string;
  }>;
  extractedEmails: string[];
  error?: string;
}

const AGGREGATOR_DOMAINS = [
  'justdial',
  'sulekha',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'youtube.com',
  'linkedin.com',
  'indiamart',
  'schools.org.in',
  'icbse.com',
  'uniformapp',
  'edustoke',
  'schoolmykids',
  'vidyavision',
  'targetstudy',
  'wikipedia.org',
  'google.com',
];

function classifySourceFromUrl(url: string, snippet = ''): SourceType {
  const lowerUrl = url.toLowerCase();
  const lowerSnippet = snippet.toLowerCase();
  if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com') || lowerSnippet.includes('facebook')) {
    return 'Facebook';
  }
  if (lowerUrl.includes('justdial.com') || lowerSnippet.includes('justdial')) {
    return 'Justdial';
  }
  if (lowerUrl.includes('cbse') || lowerUrl.includes('saras.cbse')) {
    return 'CBSE Directory';
  }
  if (
    ['schools.org.in', 'icbse.com', 'edustoke', 'schoolmykids', 'uniformapp', 'vidyavision', 'targetstudy', 'sulekha', 'indiamart'].some(
      (d) => lowerUrl.includes(d) || lowerSnippet.includes(d)
    )
  ) {
    return 'Public Directory';
  }
  return 'Google Search Grounding';
}

function pickBestGroundedUrl(
  groundedUrls: Array<{ url: string; title: string }>,
  snippet: string,
  fallbackUrl: string
): string {
  const lowerSnippet = snippet.toLowerCase();
  if (lowerSnippet.includes('facebook')) {
    const fb = groundedUrls.find((g) => g.url.toLowerCase().includes('facebook.com') || g.url.toLowerCase().includes('fb.com'));
    if (fb) return fb.url;
  }
  if (lowerSnippet.includes('justdial')) {
    const jd = groundedUrls.find((g) => g.url.toLowerCase().includes('justdial.com'));
    if (jd) return jd.url;
  }
  if (lowerSnippet.includes('schools.org') || lowerSnippet.includes('icbse') || lowerSnippet.includes('edustoke')) {
    const dir = groundedUrls.find((g) =>
      ['schools.org.in', 'icbse.com', 'edustoke', 'schoolmykids'].some((d) => g.url.toLowerCase().includes(d))
    );
    if (dir) return dir.url;
  }
  return groundedUrls[0]?.url || fallbackUrl;
}

function parseGroundedResponse(
  summaryText: string,
  chunks: Array<unknown>
): GroundedSearchEvidence {
  const groundedUrls: Array<{ url: string; title: string }> = [];
  const discoveredWebsites: string[] = [];

  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: string; title?: string } }).web;
    if (web?.uri) {
      groundedUrls.push({ url: web.uri, title: web.title || web.uri });
      const lower = web.uri.toLowerCase();
      const isAggregator = AGGREGATOR_DOMAINS.some((agg) => lower.includes(agg));
      if (!isAggregator) {
        try {
          const origin = new URL(web.uri).origin;
          if (!discoveredWebsites.includes(origin)) {
            discoveredWebsites.push(origin);
          }
        } catch {
          // ignore invalid URI
        }
      }
    }
  }

  const phones = extractPhonesFromText(summaryText)
    .map((p) => {
      const idx = summaryText.search(new RegExp(p.canonicalDigits.slice(-5)));
      const snippet =
        idx >= 0
          ? summaryText.slice(Math.max(0, idx - 80), Math.min(summaryText.length, idx + 100))
          : '';
      return { ...p, snippet };
    })
    .filter((p) => !isLikelyNonPhoneContext(p.snippet));

  const emails = extractEmailsFromText(summaryText);

  return {
    summaryText,
    groundedUrls,
    discoveredWebsites,
    extractedPhones: phones,
    extractedEmails: emails,
  };
}

async function runMultiQuerySearchGrounding(
  ai: GoogleGenAI,
  school: SchoolRecord
): Promise<GroundedSearchEvidence> {
  const locationParts = [school.district, school.state || 'Bihar'].filter(Boolean).join(', ');
  const affiliationHint = school.affiliationNumber ? `Affiliation No ${school.affiliationNumber}` : '';
  const codeHint = school.schoolCode ? `School Code ${school.schoolCode}` : '';

  const prompt = `Search Google for publicly available contact details (especially OFFICIAL PHONE/MOBILE/LANDLINE NUMBERS and EMAIL ADDRESS) for this school in India. Report ONLY factual information found in search results. Do NOT guess or invent any phone number or email.

School Name: ${school.schoolName}
Principal Name: ${school.principalName || 'Not specified'}
District: ${school.district || 'Unknown'}
State: ${school.state || 'Unknown'}
Address: ${school.originalAddress || 'Not provided'}
${affiliationHint}
${codeHint}
Known Website: ${school.originalWebsite || 'Not provided'}

Execute multiple Google search queries:
1. "${school.schoolName}" "${locationParts}" contact number phone mobile email
2. "${school.schoolName}" "${school.district || ''}" official website contact us email
3. "${school.schoolName}" ${affiliationHint || codeHint || locationParts} CBSE affiliation contact email phone

Report clearly:
- Exact official website URL (if any)
- Exact official phone numbers (mobile, landline, office, or principal contact ONLY if publicly listed)
- Exact official email address
- Exact complete street address
- Exact source website/page URL next to each contact detail.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const summaryText = response.text ?? '';
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    return parseGroundedResponse(summaryText, chunks);
  } catch (err) {
    return {
      summaryText: '',
      groundedUrls: [],
      discoveredWebsites: [],
      extractedPhones: [],
      extractedEmails: [],
      error: err instanceof Error ? err.message : 'Gemini search grounding failed',
    };
  }
}

async function runDeepDirectorySearchGrounding(
  ai: GoogleGenAI,
  school: SchoolRecord
): Promise<GroundedSearchEvidence> {
  const district = school.district || '';
  const state = school.state || 'India';
  const affiliationHint = school.affiliationNumber ? `Affiliation ${school.affiliationNumber}` : '';

  const prompt = `A primary Google/website check did not return complete contact details for this school. Now perform a THOROUGH fallback search across Facebook school pages, Justdial listings, and Indian public school directories (schools.org.in, icbse.com, edustoke, schoolmykids, sulekha). Report ONLY factual numbers and emails present in real search results — NEVER invent or guess any digit.

Target School:
- School Name: ${school.schoolName}
- District: ${district || 'Unknown'}
- State: ${state}
- Address: ${school.originalAddress || 'Not provided'}
- Principal Name: ${school.principalName || 'Not specified'}
${affiliationHint ? `- ${affiliationHint}` : ''}

Run targeted queries across all these platforms:
1. site:facebook.com "${school.schoolName}" "${district}" phone OR contact OR mobile OR email
2. site:justdial.com "${school.schoolName}" "${district}"
3. "${school.schoolName}" "${district}" ("schools.org.in" OR "icbse.com" OR "edustoke" OR "schoolmykids" OR "sulekha") contact phone email

Report clearly:
- Phone / mobile / landline numbers found on Facebook page, Justdial listing, or school directory (label the exact platform e.g. Facebook, Justdial, schools.org.in next to each number)
- Any email address or official website discovered on those pages
- Exact source URL for each listing.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const summaryText = response.text ?? '';
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    return parseGroundedResponse(summaryText, chunks);
  } catch (err) {
    return {
      summaryText: '',
      groundedUrls: [],
      discoveredWebsites: [],
      extractedPhones: [],
      extractedEmails: [],
      error: err instanceof Error ? err.message : 'Deep Facebook/Justdial fallback search failed',
    };
  }
}

interface AiVerificationOutput {
  matchedOfficialWebsite: string;
  matchedAddress: string;
  matchedEmail: string;
  principalContact: string;
  overallConfidence: number;
  overallVerificationStatus: VerificationStatus;
  verificationNotes: string;
  verifiedCandidates: Array<{
    phoneNumber: string;
    phoneType: 'mobile' | 'landline' | 'tollfree' | 'unknown';
    role: 'official' | 'principal' | 'office' | 'general';
    sourceWebsite: string;
    sourceUrl: string;
    sourceType: SourceType;
    confidenceScore: number;
    verificationStatus: VerificationStatus;
    notes: string;
  }>;
}

interface RawCandidateEvidence {
  phoneNumber: string;
  canonicalDigits: string;
  phoneType: 'mobile' | 'landline' | 'tollfree' | 'unknown';
  roleHint: string;
  role: 'official' | 'principal' | 'office' | 'general';
  sourceWebsite: string;
  sourceUrl: string;
  sourceType: SourceType;
  contextSnippet: string;
  viaTelLink: boolean;
}

function appendGroundedEvidenceCandidates(
  evidence: GroundedSearchEvidence | null,
  fallbackUrl: string,
  rawEvidenceCandidates: RawCandidateEvidence[],
  seenCanonical: Set<string>
) {
  if (!evidence) return;
  for (const p of evidence.extractedPhones) {
    const matchedUrl = pickBestGroundedUrl(evidence.groundedUrls, p.snippet, fallbackUrl);
    const key = `${p.canonicalDigits}|${matchedUrl}`;
    if (seenCanonical.has(key)) continue;
    seenCanonical.add(key);

    let host = 'google.com';
    try {
      host = new URL(matchedUrl).hostname;
    } catch {
      // ignore
    }

    rawEvidenceCandidates.push({
      phoneNumber: p.formatted,
      canonicalDigits: p.canonicalDigits,
      phoneType: p.phoneType,
      roleHint: 'general',
      role: 'general',
      sourceWebsite: host,
      sourceUrl: matchedUrl,
      sourceType: classifySourceFromUrl(matchedUrl, p.snippet),
      contextSnippet: p.snippet || evidence.summaryText.slice(0, 200),
      viaTelLink: false,
    });
  }
}

function buildDeterministicVerification(params: {
  school: SchoolRecord;
  settings: SearchSettings;
  rawCandidates: RawCandidateEvidence[];
  crawlResults: WebsiteCrawlResult[];
  mapsResult: MapsPlaceResult | null;
  errors: string[];
}): { enriched: EnrichedContactData; error?: string } {
  const { school, settings, rawCandidates, crawlResults, mapsResult, errors } = params;

  const deduped = new Map<string, ExtractedContactCandidate>();

  for (const raw of rawCandidates) {
    let score = 60;
    let status: VerificationStatus = 'Unverified';
    let notes = 'Extracted from public source';

    if (raw.sourceType === 'Google Maps Places') {
      score = 88;
      status = 'Verified';
      notes = `Matched Google Maps listing${mapsResult?.displayName ? ` (${mapsResult.displayName})` : ''}`;
    } else if (raw.sourceType === 'Official Website') {
      const lowerUrl = raw.sourceUrl.toLowerCase();
      if (raw.viaTelLink || lowerUrl.includes('contact')) {
        score = 86;
        status = 'Verified';
        notes = 'Extracted directly from official school website Contact page';
      } else {
        score = 78;
        status = 'Verified';
        notes = 'Extracted directly from official school website';
      }
    } else if (raw.sourceType === 'CBSE Directory') {
      score = 84;
      status = 'Verified';
      notes = 'Extracted from official CBSE directory page';
    } else if (raw.sourceType === 'Facebook') {
      score = 72;
      status = 'Unverified';
      notes = 'Extracted from school Facebook page';
    } else if (raw.sourceType === 'Justdial') {
      score = 68;
      status = 'Unverified';
      notes = 'Extracted from Justdial directory listing';
    }

    const existing = deduped.get(raw.canonicalDigits);
    if (!existing || score > existing.confidenceScore) {
      deduped.set(raw.canonicalDigits, {
        phoneNumber: raw.phoneNumber,
        phoneType: raw.phoneType,
        role: raw.role,
        sourceWebsite: raw.sourceWebsite,
        sourceUrl: raw.sourceUrl,
        sourceType: raw.sourceType,
        confidenceScore: existing && raw.sourceType !== existing.sourceType ? Math.min(96, Math.max(score, existing.confidenceScore) + 6) : score,
        verificationStatus: status,
        notes,
      });
    }
  }

  const validCandidates = Array.from(deduped.values()).sort(
    (a, b) => b.confidenceScore - a.confidenceScore
  );

  const mobileCandidate = validCandidates.find((c) => c.phoneType === 'mobile');
  const nonPrincipal = validCandidates.filter((c) => c.role !== 'principal');
  const primaryList = nonPrincipal.length > 0 ? nonPrincipal : validCandidates;

  const phone1 = primaryList[0]?.phoneNumber || 'Not Found';
  const phone2 =
    settings.searchMultipleNumbers && primaryList[1]?.phoneNumber
      ? primaryList[1].phoneNumber
      : 'Not Found';
  const mobileNumber = mobileCandidate?.phoneNumber || 'Not Found';
  const principalCandidate = validCandidates.find((c) => c.role === 'principal');
  const principalContact = principalCandidate?.phoneNumber || 'Not Found';

  const crawledEmails = crawlResults.flatMap((c) => c.emails.map((e) => e.email));
  const finalEmail = crawledEmails[0] || 'Not Found';

  const officialWebsite =
    mapsResult?.websiteUri ||
    crawlResults.find((c) => c.visitedUrls.length > 0)?.websiteUrl ||
    school.originalWebsite ||
    'Not Found';

  const address = mapsResult?.formattedAddress || school.originalAddress || 'Not Found';
  const sourceUrl =
    validCandidates[0]?.sourceUrl ||
    mapsResult?.googleMapsUri ||
    crawlResults.find((c) => c.visitedUrls.length > 0)?.visitedUrls[0] ||
    'Not Found';

  const bestStatus: VerificationStatus =
    validCandidates.length === 0
      ? 'Not Found'
      : validCandidates.some((c) => c.verificationStatus === 'Verified')
        ? 'Verified'
        : 'Unverified';

  const overallConfidence = validCandidates.length > 0 ? validCandidates[0].confidenceScore : 0;

  const fallbackMissingNote =
    !isGeminiConfigured() && (settings.includePublicSearch || settings.includeFacebookAndJustdial !== false)
      ? 'Set GEMINI_API_KEY in AI Studio Settings > Secrets to enable live Google Search, Facebook & Justdial fallback.'
      : '';

  const finalNotes =
    validCandidates.length > 0
      ? `Matched deterministically via ${Array.from(new Set(validCandidates.map((c) => c.sourceType))).join(' + ')}.`
      : [
          ...errors,
          fallbackMissingNote || (errors.length === 0 ? 'No public phone number found in crawled website or Google Maps listing.' : ''),
        ]
          .filter(Boolean)
          .join(' · ');

  return {
    enriched: {
      address,
      officialWebsite,
      phone1,
      phone2,
      mobileNumber,
      emailAddress: finalEmail,
      principalContact,
      sourceUrl,
      confidenceScore: overallConfidence,
      verificationStatus: bestStatus,
      googleMapsPlaceId: mapsResult?.placeId,
      googleMapsUrl: mapsResult?.googleMapsUri,
      verificationNotes: finalNotes,
      candidates: validCandidates,
    },
    error: mapsResult?.quotaExceeded ? mapsResult.error : undefined,
  };
}

export async function enrichAndVerifySchool(
  school: SchoolRecord,
  settings: SearchSettings
): Promise<{ enriched: EnrichedContactData; error?: string }> {
  const ai = createGeminiClient();

  const shouldCrawlWebsite =
    settings.searchMode === 'official_website_only' ||
    (settings.searchMode === 'all_public' && settings.includeOfficialWebsite);

  const shouldSearchMaps =
    settings.searchMode === 'google_maps_only' ||
    (settings.searchMode === 'all_public' && settings.includeGoogleMaps);

  const shouldUsePublicSearch =
    Boolean(ai) && settings.searchMode === 'all_public' && settings.includePublicSearch;

  const shouldUseFacebookAndJustdial =
    Boolean(ai) && settings.searchMode === 'all_public' && (settings.includeFacebookAndJustdial ?? true);

  // STAGE 1: Google Maps Places API lookup + Official Website crawl + CBSE Details URL crawl in parallel
  const initialWebsite = normalizeUrl(school.originalWebsite);
  const cbseUrl = school.cbseDetailsUrl ? normalizeUrl(school.cbseDetailsUrl) : null;

  const [mapsResult, initialCrawl, cbseCrawl] = await Promise.all([
    shouldSearchMaps
      ? searchGoogleMapsPlace({
          schoolName: school.schoolName,
          district: school.district,
          state: school.state,
          address: school.originalAddress,
        })
      : Promise.resolve<MapsPlaceResult | null>(null),
    shouldCrawlWebsite && initialWebsite
      ? crawlOfficialWebsite(initialWebsite)
      : Promise.resolve<WebsiteCrawlResult | null>(null),
    shouldCrawlWebsite && cbseUrl
      ? crawlSinglePage(cbseUrl)
      : Promise.resolve<WebsiteCrawlResult | null>(null),
  ]);

  const crawlResults: WebsiteCrawlResult[] = [];
  if (initialCrawl) crawlResults.push(initialCrawl);
  if (cbseCrawl && (cbseCrawl.contacts.length > 0 || cbseCrawl.emails.length > 0)) {
    crawlResults.push(cbseCrawl);
  }

  // Crawl Maps-discovered website if it's a different host AND we are still missing phone or email
  if (shouldCrawlWebsite && mapsResult?.websiteUri) {
    const mapsSite = normalizeUrl(mapsResult.websiteUri);
    let alreadyCrawled = false;
    try {
      alreadyCrawled = Boolean(
        mapsSite && initialWebsite && new URL(mapsSite).hostname === new URL(initialWebsite).hostname
      );
    } catch {
      alreadyCrawled = false;
    }
    const hasContacts = crawlResults.some((c) => c.contacts.length > 0);
    const hasEmail = crawlResults.some((c) => c.emails.length > 0);
    if (mapsSite && !alreadyCrawled && (!hasContacts || !hasEmail)) {
      const crawled = await crawlOfficialWebsite(mapsSite);
      crawlResults.push(crawled);
    }
  }

  const stage1HasPhone =
    crawlResults.some((c) => c.contacts.length > 0) || Boolean(mapsResult?.found && mapsResult.phoneNumber);
  const stage1HasEmail = crawlResults.some((c) => c.emails.length > 0);

  // STAGE 2: Google Search Grounding (if phone or email still missing after Stage 1)
  let searchEvidence: GroundedSearchEvidence | null = null;
  if (ai && shouldUsePublicSearch && (!stage1HasPhone || !stage1HasEmail)) {
    searchEvidence = await runMultiQuerySearchGrounding(ai, school);

    if (shouldCrawlWebsite && searchEvidence.discoveredWebsites.length > 0) {
      const hasPhoneAfterGoogle = stage1HasPhone || searchEvidence.extractedPhones.length > 0;
      const hasEmailAfterGoogle = stage1HasEmail || searchEvidence.extractedEmails.length > 0;
      if (!hasPhoneAfterGoogle || !hasEmailAfterGoogle) {
        for (const discovered of searchEvidence.discoveredWebsites.slice(0, 2)) {
          const alreadyCrawled = crawlResults.some((c) => c.websiteUrl.startsWith(discovered));
          if (!alreadyCrawled) {
            const crawled = await crawlOfficialWebsite(discovered);
            crawlResults.push(crawled);
            if (crawled.contacts.length > 0 && crawled.emails.length > 0) break;
          }
        }
      }
    }
  }

  const stage2HasPhone =
    crawlResults.some((c) => c.contacts.length > 0) ||
    Boolean(mapsResult?.found && mapsResult.phoneNumber) ||
    Boolean(searchEvidence && searchEvidence.extractedPhones.length > 0);
  const stage2HasEmail =
    crawlResults.some((c) => c.emails.length > 0) ||
    Boolean(searchEvidence && searchEvidence.extractedEmails.length > 0);

  // STAGE 3: Deep Fallback on Facebook, Justdial & Public School Directories when phone or email still missing
  let deepSearchEvidence: GroundedSearchEvidence | null = null;
  if (ai && shouldUseFacebookAndJustdial && (!stage2HasPhone || !stage2HasEmail)) {
    deepSearchEvidence = await runDeepDirectorySearchGrounding(ai, school);

    if (shouldCrawlWebsite && deepSearchEvidence.discoveredWebsites.length > 0) {
      for (const discovered of deepSearchEvidence.discoveredWebsites.slice(0, 1)) {
        const alreadyCrawled = crawlResults.some((c) => c.websiteUrl.startsWith(discovered));
        if (!alreadyCrawled) {
          const crawled = await crawlOfficialWebsite(discovered);
          crawlResults.push(crawled);
        }
      }
    }
  }

  // STAGE 3B: Directly crawl open public directory URLs surfaced by Google grounding if phone or email is still missing
  const OPEN_DIRECTORY_HOSTS = [
    'schools.org.in',
    'icbse.com',
    'edustoke.com',
    'schoolmykids.com',
    'vidyavision.com',
    'targetstudy.com',
    'uniformapp.in',
  ];
  const stage3HasPhone =
    stage2HasPhone ||
    crawlResults.some((c) => c.contacts.length > 0) ||
    Boolean(deepSearchEvidence && deepSearchEvidence.extractedPhones.length > 0);
  const stage3HasEmail =
    stage2HasEmail ||
    crawlResults.some((c) => c.emails.length > 0) ||
    Boolean(deepSearchEvidence && deepSearchEvidence.extractedEmails.length > 0);

  if (!stage3HasPhone || !stage3HasEmail) {
    const candidateDirUrls = [
      ...(searchEvidence?.groundedUrls || []),
      ...(deepSearchEvidence?.groundedUrls || []),
    ]
      .map((u) => u.url)
      .filter((u) => OPEN_DIRECTORY_HOSTS.some((h) => u.toLowerCase().includes(h)))
      .filter((u, idx, arr) => arr.indexOf(u) === idx)
      .slice(0, 2);

    if (candidateDirUrls.length > 0) {
      const dirCrawls = await Promise.all(candidateDirUrls.map((u) => crawlSinglePage(u)));
      for (const dc of dirCrawls) {
        if (dc.contacts.length > 0 || dc.emails.length > 0) {
          crawlResults.push(dc);
        }
      }
    }
  }

  // Collect all raw real candidate phone numbers discovered across all stages
  const rawEvidenceCandidates: RawCandidateEvidence[] = [];
  const seenCanonical = new Set<string>();

  for (const crawl of crawlResults) {
    for (const c of crawl.contacts) {
      const key = `${c.phone.canonicalDigits}|${c.sourceUrl}`;
      if (seenCanonical.has(key)) continue;
      seenCanonical.add(key);
      const lowerUrl = c.sourceUrl.toLowerCase();
      const sourceType: SourceType = lowerUrl.includes('cbse')
        ? 'CBSE Directory'
        : OPEN_DIRECTORY_HOSTS.some((h) => lowerUrl.includes(h))
          ? 'Public Directory'
          : 'Official Website';

      rawEvidenceCandidates.push({
        phoneNumber: c.phone.formatted,
        canonicalDigits: c.phone.canonicalDigits,
        phoneType: c.phone.phoneType,
        roleHint: c.viaTelLink ? `${c.isPrincipalOrOffice} (via tel: link)` : c.isPrincipalOrOffice,
        role: c.isPrincipalOrOffice === 'general' ? 'official' : c.isPrincipalOrOffice,
        sourceWebsite: c.sourceWebsite,
        sourceUrl: c.sourceUrl,
        sourceType,
        contextSnippet: c.contextSnippet,
        viaTelLink: c.viaTelLink,
      });
    }
  }

  if (mapsResult?.found && mapsResult.phoneNumber) {
    const norm = normalizeIndianPhone(mapsResult.phoneNumber);
    const canonicalDigits = norm?.canonicalDigits || mapsResult.phoneNumber.replace(/\D/g, '');
    const mapsUrl = mapsResult.googleMapsUri || 'https://maps.google.com';
    const key = `${canonicalDigits}|${mapsUrl}`;
    if (!seenCanonical.has(key)) {
      seenCanonical.add(key);
      rawEvidenceCandidates.push({
        phoneNumber: norm?.formatted || mapsResult.phoneNumber,
        canonicalDigits,
        phoneType: norm?.phoneType || 'unknown',
        roleHint: 'official',
        role: 'official',
        sourceWebsite: 'maps.google.com',
        sourceUrl: mapsUrl,
        sourceType: 'Google Maps Places',
        contextSnippet: `Google Maps listing: ${mapsResult.displayName || ''} — ${mapsResult.formattedAddress || ''}`,
        viaTelLink: false,
      });
    }
  }

  appendGroundedEvidenceCandidates(
    searchEvidence,
    'https://www.google.com/search',
    rawEvidenceCandidates,
    seenCanonical
  );
  appendGroundedEvidenceCandidates(
    deepSearchEvidence,
    'https://www.google.com/search',
    rawEvidenceCandidates,
    seenCanonical
  );

  const collectedErrors = [
    ...crawlResults.flatMap((c) => c.errors),
    mapsResult?.error,
    searchEvidence?.error,
    deepSearchEvidence?.error,
  ].filter((v): v is string => Boolean(v));

  // If Gemini is NOT configured, return deterministic verification over real Google Maps + Website Crawl results
  if (!ai) {
    return buildDeterministicVerification({
      school,
      settings,
      rawCandidates: rawEvidenceCandidates,
      crawlResults,
      mapsResult,
      errors: collectedErrors,
    });
  }

  const allSearchEmails = Array.from(
    new Set([
      ...(searchEvidence?.extractedEmails || []),
      ...(deepSearchEvidence?.extractedEmails || []),
    ])
  );
  const allGroundedUrls = [
    ...(searchEvidence?.groundedUrls || []),
    ...(deepSearchEvidence?.groundedUrls || []),
  ];

  const hasAnySignal =
    rawEvidenceCandidates.length > 0 ||
    Boolean(mapsResult?.found) ||
    crawlResults.some((c) => c.emails.length > 0 || c.addressSnippets.length > 0) ||
    Boolean(searchEvidence?.summaryText) ||
    Boolean(deepSearchEvidence?.summaryText);

  if (!hasAnySignal) {
    return {
      enriched: {
        address: school.originalAddress || 'Not Found',
        officialWebsite: school.originalWebsite || 'Not Found',
        phone1: 'Not Found',
        phone2: 'Not Found',
        mobileNumber: 'Not Found',
        emailAddress: 'Not Found',
        principalContact: 'Not Found',
        sourceUrl: 'Not Found',
        confidenceScore: 0,
        verificationStatus: 'Not Found',
        verificationNotes:
          collectedErrors.length > 0 ? collectedErrors.join('; ') : 'No public contact records discovered.',
        candidates: [],
      },
      error: mapsResult?.quotaExceeded ? mapsResult.error : undefined,
    };
  }

  // STAGE 4: Gemini AI Verification & School Matching across all evidence
  const verificationPrompt = `You are a strict data verification specialist for "School Contact Finder AI".
Verify whether the discovered contact evidence belongs to the EXACT target school below.

TARGET SCHOOL RECORD:
- School Name: ${school.schoolName}
- District: ${school.district || 'Not specified'}
- State: ${school.state || 'Not specified'}
- Original Address: ${school.originalAddress || 'Not specified'}
- Affiliation Number: ${school.affiliationNumber || 'Not specified'}
- School Code: ${school.schoolCode || 'Not specified'}
- Original Website: ${school.originalWebsite || 'Not specified'}

COLLECTED REAL EVIDENCE:
1) Website Crawl Results:
${JSON.stringify(
  crawlResults.map((c) => ({
    websiteUrl: c.websiteUrl,
    visitedUrls: c.visitedUrls,
    emails: c.emails,
    addressSnippets: c.addressSnippets,
    blockedByRobots: c.blockedByRobots,
    errors: c.errors,
  })),
  null,
  2
)}

2) Google Maps Places API Result:
${JSON.stringify(mapsResult || { found: false }, null, 2)}

3) Primary Google Search Grounding Summary & URLs:
Summary: ${searchEvidence?.summaryText || 'None'}
Grounded URLs: ${JSON.stringify(searchEvidence?.groundedUrls || [])}

4) Fallback Search (Facebook, Justdial & Public School Directories):
Summary: ${deepSearchEvidence?.summaryText || 'None'}
Grounded URLs: ${JSON.stringify(deepSearchEvidence?.groundedUrls || [])}
Emails found in search: ${JSON.stringify(allSearchEmails)}

5) Candidate Phone Numbers Extracted from Real Sources:
${JSON.stringify(rawEvidenceCandidates, null, 2)}

STRICT RULES:
- NEVER invent, guess, modify, or fabricate any phone number, email, or URL. You may ONLY select from Candidate Phone Numbers or exact URLs/emails present in the collected evidence above.
- Compare School Name, District, State, and Address carefully. Reject phone numbers from schools in a different district/city/state or unrelated businesses.
- Use one of these exact sourceType values for each selected candidate: "Official Website", "Google Maps Places", "Google Search Grounding", "Facebook", "Justdial", "Public Directory", "CBSE Directory".
- Mark a candidate as "Verified" (confidenceScore 75–98) if it comes from the school's official website, official CBSE record, confirmed Google Maps listing, or an official Facebook page / directory record that unambiguously matches the exact School Name and District/State.
- Mark a candidate as "Unverified" (confidenceScore 50–74) if it comes from Justdial, Facebook, or a third-party school directory where the school name & district match plausibly but without official website confirmation.
- Only populate principalContact if a phone number is explicitly labeled as Principal / Headmaster / Director contact in the evidence; otherwise return "Not Found".
- If no reliable phone number exists in the evidence, return empty verifiedCandidates and overallVerificationStatus = "Not Found".`;

  try {
    const verificationResponse = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: verificationPrompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matchedOfficialWebsite: { type: Type.STRING },
            matchedAddress: { type: Type.STRING },
            matchedEmail: { type: Type.STRING },
            principalContact: { type: Type.STRING },
            overallConfidence: { type: Type.NUMBER },
            overallVerificationStatus: { type: Type.STRING },
            verificationNotes: { type: Type.STRING },
            verifiedCandidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  phoneNumber: { type: Type.STRING },
                  phoneType: { type: Type.STRING },
                  role: { type: Type.STRING },
                  sourceWebsite: { type: Type.STRING },
                  sourceUrl: { type: Type.STRING },
                  sourceType: { type: Type.STRING },
                  confidenceScore: { type: Type.NUMBER },
                  verificationStatus: { type: Type.STRING },
                  notes: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const rawJson = (verificationResponse.text ?? '{}').trim();
    const parsed = JSON.parse(rawJson) as Partial<AiVerificationOutput>;

    const allowedDigits = new Set(rawEvidenceCandidates.map((c) => c.canonicalDigits));
    const validCandidates: ExtractedContactCandidate[] = [];
    const seenFinalDigits = new Set<string>();

    for (const cand of parsed.verifiedCandidates ?? []) {
      const norm = normalizeIndianPhone(cand.phoneNumber || '');
      const digits = norm?.canonicalDigits || (cand.phoneNumber || '').replace(/\D/g, '');
      if (!digits || (!allowedDigits.has(digits) && rawEvidenceCandidates.length > 0)) {
        continue;
      }
      if (seenFinalDigits.has(digits)) continue;
      seenFinalDigits.add(digits);

      const status: VerificationStatus =
        cand.verificationStatus === 'Verified'
          ? 'Verified'
          : cand.verificationStatus === 'Unverified'
            ? 'Unverified'
            : 'Not Found';

      if (status === 'Not Found') continue;

      const allowedSourceTypes: SourceType[] = [
        'Official Website',
        'Google Maps Places',
        'Google Search Grounding',
        'Facebook',
        'Justdial',
        'Public Directory',
        'CBSE Directory',
      ];

      validCandidates.push({
        phoneNumber: norm?.formatted || cand.phoneNumber,
        phoneType: (norm?.phoneType || cand.phoneType || 'unknown') as ExtractedContactCandidate['phoneType'],
        role: (['official', 'principal', 'office', 'general'].includes(cand.role)
          ? cand.role
          : 'official') as ExtractedContactCandidate['role'],
        sourceWebsite: cand.sourceWebsite || 'Unknown',
        sourceUrl: cand.sourceUrl || 'Not Found',
        sourceType: allowedSourceTypes.includes(cand.sourceType)
          ? cand.sourceType
          : classifySourceFromUrl(cand.sourceUrl || ''),
        confidenceScore: Math.max(0, Math.min(100, Math.round(Number(cand.confidenceScore) || 0))),
        verificationStatus: status,
        notes: cand.notes || undefined,
      });
    }

    validCandidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

    const mobileCandidate = validCandidates.find((c) => c.phoneType === 'mobile');
    const nonPrincipal = validCandidates.filter((c) => c.role !== 'principal');
    const primaryList = nonPrincipal.length > 0 ? nonPrincipal : validCandidates;

    const phone1 = primaryList[0]?.phoneNumber || 'Not Found';
    const phone2 =
      settings.searchMultipleNumbers && primaryList[1]?.phoneNumber
        ? primaryList[1].phoneNumber
        : 'Not Found';
    const mobileNumber = mobileCandidate?.phoneNumber || 'Not Found';

    let principalContact = 'Not Found';
    if (parsed.principalContact && parsed.principalContact !== 'Not Found') {
      const pNorm = normalizeIndianPhone(parsed.principalContact);
      if (pNorm && allowedDigits.has(pNorm.canonicalDigits)) {
        principalContact = pNorm.formatted;
      }
    } else {
      const explicitPrincipal = validCandidates.find((c) => c.role === 'principal');
      if (explicitPrincipal) principalContact = explicitPrincipal.phoneNumber;
    }

    const bestStatus: VerificationStatus =
      validCandidates.length === 0
        ? 'Not Found'
        : validCandidates.some((c) => c.verificationStatus === 'Verified')
          ? 'Verified'
          : 'Unverified';

    const overallConfidence =
      validCandidates.length > 0
        ? Math.max(
            ...validCandidates.map((c) => c.confidenceScore),
            Math.round(Number(parsed.overallConfidence) || 0)
          )
        : 0;

    const crawledEmails = crawlResults.flatMap((c) => c.emails.map((e) => e.email));
    const allAllowedEmails = new Set([
      ...crawledEmails,
      ...allSearchEmails,
    ]);
    let finalEmail = 'Not Found';
    if (parsed.matchedEmail && parsed.matchedEmail !== 'Not Found') {
      const candidateEmail = parsed.matchedEmail.trim().toLowerCase();
      if (allAllowedEmails.has(candidateEmail) || candidateEmail.includes('@')) {
        finalEmail = candidateEmail;
      }
    } else if (crawledEmails[0]) {
      finalEmail = crawledEmails[0];
    } else if (allSearchEmails[0]) {
      finalEmail = allSearchEmails[0];
    }

    const officialWebsite =
      (parsed.matchedOfficialWebsite && parsed.matchedOfficialWebsite !== 'Not Found'
        ? parsed.matchedOfficialWebsite
        : '') ||
      mapsResult?.websiteUri ||
      crawlResults.find((c) => c.visitedUrls.length > 0)?.websiteUrl ||
      school.originalWebsite ||
      'Not Found';

    const address =
      (parsed.matchedAddress && parsed.matchedAddress !== 'Not Found' ? parsed.matchedAddress : '') ||
      mapsResult?.formattedAddress ||
      school.originalAddress ||
      'Not Found';

    const sourceUrl =
      validCandidates[0]?.sourceUrl ||
      mapsResult?.googleMapsUri ||
      crawlResults.find((c) => c.visitedUrls.length > 0)?.visitedUrls[0] ||
      allGroundedUrls[0]?.url ||
      'Not Found';

    return {
      enriched: {
        address,
        officialWebsite,
        phone1,
        phone2,
        mobileNumber,
        emailAddress: finalEmail,
        principalContact,
        sourceUrl,
        confidenceScore: overallConfidence,
        verificationStatus: bestStatus,
        googleMapsPlaceId: mapsResult?.placeId,
        googleMapsUrl: mapsResult?.googleMapsUri,
        verificationNotes: parsed.verificationNotes || undefined,
        candidates: validCandidates,
      },
      error: mapsResult?.quotaExceeded ? mapsResult.error : undefined,
    };
  } catch {
    // Graceful fallback to deterministic extraction if Gemini API call errors (e.g. 429/invalid key)
    return buildDeterministicVerification({
      school,
      settings,
      rawCandidates: rawEvidenceCandidates,
      crawlResults,
      mapsResult,
      errors: collectedErrors,
    });
  }
}
