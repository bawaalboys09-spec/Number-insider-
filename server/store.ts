import fs from 'node:fs';
import path from 'node:path';
import type { BatchJob, BatchJobSummary, BatchStats } from '../src/types/school.ts';
import { autoDetectColumnMapping } from './excel.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function computeBatchStats(job: BatchJob): BatchStats {
  const totalSchools = job.schools.length;
  let completedSearches = 0;
  let numbersFound = 0;
  let numbersNotFound = 0;
  let verifiedNumbers = 0;
  let duplicateNumbers = 0;
  let failedSearches = 0;
  let pendingSearches = 0;
  let emailsFound = 0;
  const sourceBreakdown: Record<string, number> = {};

  for (const s of job.schools) {
    if (s.status === 'Pending' || s.status === 'Searching') {
      pendingSearches++;
    } else {
      completedSearches++;
    }

    if (s.status === 'Failed') {
      failedSearches++;
    }

    if (s.status === 'Duplicate' || s.enriched.isDuplicate) {
      duplicateNumbers++;
    }

    if (s.enriched.emailAddress && s.enriched.emailAddress !== 'Not Found') {
      emailsFound++;
    }

    const hasNumber =
      (s.enriched.phone1 && s.enriched.phone1 !== 'Not Found') ||
      (s.enriched.mobileNumber && s.enriched.mobileNumber !== 'Not Found');

    if (hasNumber) {
      numbersFound++;
      if (s.enriched.verificationStatus === 'Verified') {
        verifiedNumbers++;
      }
      const primarySource = s.enriched.candidates?.[0]?.sourceType || 'Official Website';
      sourceBreakdown[primarySource] = (sourceBreakdown[primarySource] || 0) + 1;
    } else if (s.status === 'Not Found' || (s.status === 'Completed' && !hasNumber)) {
      numbersNotFound++;
    }
  }

  return {
    totalSchools,
    completedSearches,
    numbersFound,
    numbersNotFound,
    verifiedNumbers,
    duplicateNumbers,
    failedSearches,
    pendingSearches,
    emailsFound,
    sourceBreakdown,
  };
}

class JobStore {
  private jobs = new Map<string, BatchJob>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromDisk();
  }

  private repairLegacyMapping(job: BatchJob) {
    if (!job.headers?.length || !job.rawRows?.length) return;
    const mappedNameHeader = job.columnMapping?.schoolName || '';
    if (mappedNameHeader.toLowerCase().includes('code')) {
      const better = autoDetectColumnMapping(job.headers);
      if (better.schoolName && better.schoolName !== mappedNameHeader) {
        job.columnMapping = better;
        job.schools.forEach((school, idx) => {
          const row = job.rawRows[idx];
          if (!row) return;
          school.schoolName = (row[better.schoolName] || '').trim() || school.schoolName;
          if (better.schoolCode) {
            school.schoolCode = (row[better.schoolCode] || '').trim();
          }
          if (better.affiliationNumber) {
            school.affiliationNumber = (row[better.affiliationNumber] || '').trim();
          }
          if (better.website) {
            school.originalWebsite = (row[better.website] || '').trim();
          }
        });
      }
    }
  }

  private loadFromDisk() {
    try {
      ensureDataDir();
      if (!fs.existsSync(JOBS_FILE)) return;
      const raw = fs.readFileSync(JOBS_FILE, 'utf8');
      const parsed = JSON.parse(raw) as BatchJob[];
      if (Array.isArray(parsed)) {
        for (const job of parsed) {
          if (job.status === 'running') {
            job.status = 'paused';
          }
          for (const s of job.schools) {
            if (s.status === 'Searching') s.status = 'Pending';
          }
          if (!job.settings.concurrency) {
            job.settings.concurrency = 5;
            if (job.settings.batchDelayMs === 900) {
              job.settings.batchDelayMs = 250;
            }
          }
          this.repairLegacyMapping(job);
          this.jobs.set(job.id, job);
        }
      }
    } catch {
      // ignore corrupted disk cache
    }
  }

  saveToDisk() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      ensureDataDir();
      const list = Array.from(this.jobs.values()).slice(0, 30);
      const tmp = `${JOBS_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(list), 'utf8');
      fs.renameSync(tmp, JOBS_FILE);
    } catch {
      // ignore disk write failure
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDisk();
    }, 2500);
  }

  getJob(id: string): BatchJob | undefined {
    return this.jobs.get(id);
  }

  setJob(job: BatchJob, immediate = true) {
    job.updatedAt = new Date().toISOString();
    this.jobs.set(job.id, job);
    if (immediate) {
      this.saveToDisk();
    } else {
      this.scheduleSave();
    }
  }

  deleteJob(id: string) {
    this.jobs.delete(id);
    this.saveToDisk();
  }

  listSummaries(): BatchJobSummary[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((job) => ({
        id: job.id,
        fileName: job.fileName,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        status: job.status,
        stats: computeBatchStats(job),
      }));
  }
}

export const jobStore = new JobStore();
