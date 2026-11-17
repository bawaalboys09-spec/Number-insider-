export type PhoneType = 'mobile' | 'landline' | 'tollfree' | 'unknown';

export type ContactRole = 'official' | 'principal' | 'office' | 'general';

export type SourceType =
  | 'Official Website'
  | 'Google Maps Places'
  | 'Google Search Grounding'
  | 'Facebook'
  | 'Justdial'
  | 'Public Directory'
  | 'CBSE Directory';

export type VerificationStatus = 'Verified' | 'Unverified' | 'Not Found';

export type SchoolProcessingStatus =
  | 'Pending'
  | 'Searching'
  | 'Completed'
  | 'Not Found'
  | 'Failed'
  | 'Duplicate';

export type JobStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

export type SearchMode = 'all_public' | 'official_website_only' | 'google_maps_only';

export interface ColumnMapping {
  serialNo: string;
  schoolName: string;
  affiliationNumber: string;
  schoolCode: string;
  principalName?: string;
  district: string;
  state: string;
  address: string;
  website: string;
  cbseDetailsUrl?: string;
  existingPhone?: string;
  existingEmail?: string;
}

export interface ExtractedContactCandidate {
  phoneNumber: string;
  phoneType: PhoneType;
  role: ContactRole;
  sourceWebsite: string;
  sourceUrl: string;
  sourceType: SourceType;
  confidenceScore: number;
  verificationStatus: VerificationStatus;
  notes?: string;
}

export interface EnrichedContactData {
  address: string;
  officialWebsite: string;
  phone1: string;
  phone2: string;
  mobileNumber: string;
  emailAddress: string;
  principalContact: string;
  sourceUrl: string;
  confidenceScore: number;
  verificationStatus: VerificationStatus;
  googleMapsPlaceId?: string;
  googleMapsUrl?: string;
  isDuplicate?: boolean;
  duplicateReason?: string;
  verificationNotes?: string;
  candidates: ExtractedContactCandidate[];
}

export interface SchoolRecord {
  id: string;
  sNo: string;
  schoolName: string;
  affiliationNumber: string;
  schoolCode: string;
  principalName?: string;
  district: string;
  state: string;
  originalAddress: string;
  originalWebsite: string;
  cbseDetailsUrl?: string;
  originalRow: Record<string, string>;
  status: SchoolProcessingStatus;
  attempts: number;
  errorMessage?: string;
  lastSearchedAt?: string;
  enriched: EnrichedContactData;
}

export interface SearchSettings {
  searchMode: SearchMode;
  includeGoogleMaps: boolean;
  includeOfficialWebsite: boolean;
  includePublicSearch: boolean;
  includeFacebookAndJustdial?: boolean;
  searchMultipleNumbers: boolean;
  onlyBiharSchools: boolean;
  districtFilter: string;
  missingNumbersOnly: boolean;
  recheckFailedOnly: boolean;
  maxAttemptsPerSchool: number;
  batchDelayMs: number;
  concurrency?: number;
}

export interface BatchStats {
  totalSchools: number;
  completedSearches: number;
  numbersFound: number;
  numbersNotFound: number;
  verifiedNumbers: number;
  duplicateNumbers: number;
  failedSearches: number;
  pendingSearches: number;
  emailsFound?: number;
  sourceBreakdown?: Record<string, number>;
}

export interface BatchJob {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  currentIndex: number;
  currentSchoolName?: string;
  columnMapping: ColumnMapping;
  headers: string[];
  rawRows: Record<string, string>[];
  settings: SearchSettings;
  schools: SchoolRecord[];
}

export interface BatchJobSummary {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  stats: BatchStats;
}

export interface ApiReadinessStatus {
  geminiConfigured: boolean;
  googleMapsConfigured: boolean;
  googleMapsError?: string;
  model: string;
  complianceNotes: string[];
}

export interface ParsedUploadPreview {
  fileName: string;
  sheetNames?: string[];
  selectedSheet?: string;
  detectedHeaderRow?: number;
  headers: string[];
  detectedMapping: ColumnMapping;
  rowCount: number;
  sampleRows: Record<string, string>[];
  rawRows: Record<string, string>[];
}
