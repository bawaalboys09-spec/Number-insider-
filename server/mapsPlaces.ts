import { normalizeIndianPhone } from './phoneUtils.ts';

export interface MapsPlaceResult {
  found: boolean;
  placeId?: string;
  displayName?: string;
  formattedAddress?: string;
  phoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  error?: string;
  quotaExceeded?: boolean;
}

let mapsAuthBlockedUntil = 0;
let mapsAuthBlockReason = '';

export function getGoogleMapsApiKey(): string | undefined {
  const raw = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_GOOGLE_MAPS_API_KEY') return undefined;
  return trimmed;
}

export function getMapsKeyDiagnostic(): string | undefined {
  const key = getGoogleMapsApiKey();
  if (!key) return undefined;
  if (!key.startsWith('AIza')) {
    return 'GOOGLE_MAPS_API_KEY does not appear to be a standard Google API key (expected AIza...).';
  }
  if (Date.now() < mapsAuthBlockedUntil && mapsAuthBlockReason) {
    return mapsAuthBlockReason;
  }
  return undefined;
}

async function runPlacesTextQuery(apiKey: string, textQuery: string): Promise<MapsPlaceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri',
      },
      body: JSON.stringify({
        textQuery,
        languageCode: 'en',
        regionCode: 'IN',
        maxResultCount: 3,
      }),
    });

    if (response.status === 429) {
      return {
        found: false,
        quotaExceeded: true,
        error: 'Google Maps Places API quota exceeded (HTTP 429)',
      };
    }

    if (response.status === 401 || response.status === 403) {
      const errBody = await response.text();
      mapsAuthBlockReason = `Google Maps Places API rejected key (${response.status}). Check Settings > Secrets or enable Places API (New).`;
      mapsAuthBlockedUntil = Date.now() + 1000 * 60;
      return {
        found: false,
        error: `${mapsAuthBlockReason} Details: ${errBody.slice(0, 120)}`,
      };
    }

    if (!response.ok) {
      const errBody = await response.text();
      return {
        found: false,
        error: `Places API error (${response.status}): ${errBody.slice(0, 150)}`,
      };
    }

    const data = (await response.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        nationalPhoneNumber?: string;
        internationalPhoneNumber?: string;
        websiteUri?: string;
        googleMapsUri?: string;
      }>;
    };

    const places = data.places ?? [];
    const topPlace =
      places.find((p) => p.internationalPhoneNumber || p.nationalPhoneNumber) || places[0];

    if (!topPlace) {
      return { found: false };
    }

    const rawPhone = topPlace.internationalPhoneNumber || topPlace.nationalPhoneNumber || '';
    const normalizedPhone = normalizeIndianPhone(rawPhone);

    return {
      found: true,
      placeId: topPlace.id,
      displayName: topPlace.displayName?.text,
      formattedAddress: topPlace.formattedAddress,
      phoneNumber: normalizedPhone?.formatted || rawPhone || undefined,
      websiteUri: topPlace.websiteUri,
      googleMapsUri: topPlace.googleMapsUri,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchGoogleMapsPlace(params: {
  schoolName: string;
  district?: string;
  state?: string;
  address?: string;
}): Promise<MapsPlaceResult> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return {
      found: false,
      error: 'GOOGLE_MAPS_API_KEY not configured in environment secrets',
    };
  }

  if (!apiKey.startsWith('AIza')) {
    return {
      found: false,
      error: getMapsKeyDiagnostic(),
    };
  }

  if (Date.now() < mapsAuthBlockedUntil) {
    return {
      found: false,
      error: mapsAuthBlockReason,
    };
  }

  const cleanQuery = [params.schoolName, params.district, params.state]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(', ');

  try {
    const primary = await runPlacesTextQuery(apiKey, cleanQuery);
    if (primary.quotaExceeded || primary.error) return primary;
    if (primary.found && (primary.phoneNumber || primary.websiteUri)) {
      return primary;
    }

    if (params.address?.trim()) {
      const fullQuery = [params.schoolName, params.address, params.district, params.state]
        .map((v) => v?.trim())
        .filter(Boolean)
        .join(', ');
      if (fullQuery !== cleanQuery) {
        const secondary = await runPlacesTextQuery(apiKey, fullQuery);
        if (secondary.found) return secondary;
      }
    }

    return primary;
  } catch (err) {
    return {
      found: false,
      error: err instanceof Error ? err.message : 'Google Maps Places API network failure',
    };
  }
}
