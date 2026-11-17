import type { BatchJob, SchoolRecord } from '../src/types/school.ts';
import { enrichAndVerifySchool } from './aiSearchAndVerify.ts';
import { normalizeIndianPhone } from './phoneUtils.ts';
import { computeBatchStats, jobStore } from './store.ts';

type JobListener = (payload: {
  type: 'progress' | 'status';
  jobId: string;
  jobStatus: BatchJob['status'];
  currentIndex: number;
  currentSchoolName?: string;
  message: string;
  school?: SchoolRecord;
  stats: ReturnType<typeof computeBatchStats>;
}) => void;

class BatchRunner {
  private activeLoops = new Set<string>();
  private controlFlags = new Map<string, 'run' | 'pause' | 'stop'>();
  private listeners = new Map<string, Set<JobListener>>();

  subscribe(jobId: string, listener: JobListener): () => void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private emit(job: BatchJob, type: 'progress' | 'status', message: string, school?: SchoolRecord) {
    const set = this.listeners.get(job.id);
    if (!set) return;
    const payload = {
      type,
      jobId: job.id,
      jobStatus: job.status,
      currentIndex: job.currentIndex,
      currentSchoolName: job.currentSchoolName,
      message,
      school,
      stats: computeBatchStats(job),
    };
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // ignore closed SSE listener
      }
    }
  }

  private detectDuplicates(job: BatchJob) {
    const seenSchoolKey = new Map<string, string>();
    const seenPhones = new Map<string, string>();

    for (const school of job.schools) {
      school.enriched.isDuplicate = false;
      school.enriched.duplicateReason = undefined;

      const nameKey = `${school.schoolName.toLowerCase().replace(/\s+/g, ' ').trim()}|${school.district
        .toLowerCase()
        .trim()}`;

      if (seenSchoolKey.has(nameKey)) {
        school.enriched.isDuplicate = true;
        school.enriched.duplicateReason = `Duplicate school record of S.No. ${seenSchoolKey.get(nameKey)}`;
        if (school.status === 'Pending') {
          school.status = 'Duplicate';
        }
      } else {
        seenSchoolKey.set(nameKey, school.sNo);
      }

      const phones = [school.enriched.phone1, school.enriched.mobileNumber].filter(
        (p) => p && p !== 'Not Found'
      );
      for (const phone of phones) {
        const norm = normalizeIndianPhone(phone);
        const key = norm?.canonicalDigits || phone;
        if (seenPhones.has(key) && seenPhones.get(key) !== school.sNo) {
          school.enriched.isDuplicate = true;
          school.enriched.duplicateReason = `Phone ${phone} also listed on S.No. ${seenPhones.get(key)}`;
        } else {
          seenPhones.set(key, school.sNo);
        }
      }
    }
  }

  private shouldProcessSchool(school: SchoolRecord, job: BatchJob): boolean {
    const { settings } = job;
    if (!school.schoolName.trim()) {
      school.status = 'Failed';
      school.errorMessage = 'Missing school name in source spreadsheet';
      return false;
    }

    if (settings.onlyBiharSchools) {
      const stateLower = (school.state || '').toLowerCase().trim();
      if (stateLower && stateLower !== 'bihar') {
        return false;
      }
    }

    if (settings.districtFilter.trim()) {
      const target = settings.districtFilter.toLowerCase().trim();
      const actual = (school.district || '').toLowerCase().trim();
      if (!actual.includes(target)) {
        return false;
      }
    }

    if (settings.recheckFailedOnly) {
      return school.status === 'Failed' || school.status === 'Not Found';
    }

    if (settings.missingNumbersOnly) {
      const hasNum =
        (school.enriched.phone1 && school.enriched.phone1 !== 'Not Found') ||
        (school.enriched.mobileNumber && school.enriched.mobileNumber !== 'Not Found');
      if (hasNum && school.status === 'Completed') return false;
    }

    return school.status === 'Pending' || school.status === 'Failed';
  }

  startOrResume(jobId: string) {
    const job = jobStore.getJob(jobId);
    if (!job) throw new Error('Job not found');

    if (job.status === 'completed' || job.status === 'stopped') {
      const hasWork = job.schools.some((s) => this.shouldProcessSchool(s, job));
      if (!hasWork) {
        throw new Error('No eligible pending or failed schools match the current search settings.');
      }
    }

    this.controlFlags.set(jobId, 'run');
    job.status = 'running';
    jobStore.setJob(job, true);
    this.emit(job, 'status', 'Batch enrichment started');

    if (!this.activeLoops.has(jobId)) {
      void this.runLoop(jobId);
    }
  }

  pause(jobId: string) {
    const job = jobStore.getJob(jobId);
    if (!job) throw new Error('Job not found');
    this.controlFlags.set(jobId, 'pause');
    job.status = 'paused';
    jobStore.setJob(job, true);
    this.emit(job, 'status', 'Search paused by user');
  }

  stop(jobId: string) {
    const job = jobStore.getJob(jobId);
    if (!job) throw new Error('Job not found');
    this.controlFlags.set(jobId, 'stop');
    job.status = 'stopped';
    jobStore.setJob(job, true);
    this.emit(job, 'status', 'Search stopped by user');
  }

  retryFailed(jobId: string) {
    const job = jobStore.getJob(jobId);
    if (!job) throw new Error('Job not found');
    let resetCount = 0;
    for (const s of job.schools) {
      if (s.status === 'Failed' || s.status === 'Not Found') {
        s.status = 'Pending';
        s.errorMessage = undefined;
        resetCount++;
      }
    }
    if (resetCount === 0) {
      throw new Error('There are no failed or not-found schools to retry.');
    }
    jobStore.setJob(job, true);
    this.startOrResume(jobId);
  }

  async retrySingleSchool(jobId: string, schoolId: string): Promise<SchoolRecord> {
    const job = jobStore.getJob(jobId);
    if (!job) throw new Error('Job not found');

    const idx = job.schools.findIndex((s) => s.id === schoolId);
    if (idx === -1) throw new Error('School record not found');

    const school = job.schools[idx];
    school.status = 'Searching';
    school.errorMessage = undefined;
    jobStore.setJob(job, false);
    this.emit(job, 'progress', `School ${idx + 1}/${job.schools.length} - Searching`, school);

    const outcomeStatus = await this.processOneSchool(job, school, idx);
    this.detectDuplicates(job);
    jobStore.setJob(job, true);

    const hasNum =
      school.enriched.phone1 !== 'Not Found' || school.enriched.mobileNumber !== 'Not Found';
    const label =
      outcomeStatus === 'Failed'
        ? 'Failed'
        : hasNum
          ? 'Number Found'
          : 'Not Found';
    this.emit(job, 'progress', `School ${idx + 1}/${job.schools.length} - ${label}`, school);
    return school;
  }

  private async processOneSchool(
    job: BatchJob,
    school: SchoolRecord,
    index: number
  ): Promise<SchoolRecord['status']> {
    const maxAttempts = Math.max(1, Math.min(5, job.settings.maxAttemptsPerSchool || 1));
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.controlFlags.get(job.id) !== 'run' && job.status === 'running') {
        break;
      }

      school.attempts += 1;
      try {
        const result = await enrichAndVerifySchool(school, job.settings);
        const isTransient = Boolean(result.error && (result.error.includes('429') || result.error.toLowerCase().includes('timeout')));
        if (result.error && result.enriched.candidates.length === 0 && isTransient && attempt < maxAttempts) {
          lastError = result.error;
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        school.enriched = result.enriched;
        school.lastSearchedAt = new Date().toISOString();
        const hasNum =
          result.enriched.phone1 !== 'Not Found' || result.enriched.mobileNumber !== 'Not Found';
        school.status = hasNum ? 'Completed' : 'Not Found';
        school.errorMessage = result.error;
        return school.status;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Unexpected enrichment error';
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    }

    school.status = 'Failed';
    school.lastSearchedAt = new Date().toISOString();
    school.errorMessage = lastError || 'Search failed after maximum attempts';
    job.currentIndex = index;
    return school.status;
  }

  private async runLoop(jobId: string) {
    this.activeLoops.add(jobId);
    try {
      const job = jobStore.getJob(jobId);
      if (!job) return;

      this.detectDuplicates(job);

      // Build queue of eligible indices
      const queue: number[] = [];
      for (let i = 0; i < job.schools.length; i++) {
        if (this.shouldProcessSchool(job.schools[i], job)) {
          queue.push(i);
        }
      }

      let cursor = 0;
      let processedSinceDupCheck = 0;
      const workerCount = Math.max(1, Math.min(10, job.settings.concurrency || 8));
      const delayMs = Math.max(25, Math.min(3000, job.settings.batchDelayMs ?? 100));

      const worker = async () => {
        while (true) {
          const flag = this.controlFlags.get(jobId);
          if (flag === 'pause' || flag === 'stop') {
            return;
          }

          if (cursor >= queue.length) {
            return;
          }

          const i = queue[cursor++];
          const school = job.schools[i];

          job.currentIndex = i + 1;
          job.currentSchoolName = school.schoolName;
          school.status = 'Searching';
          jobStore.setJob(job, false);

          this.emit(
            job,
            'progress',
            `School ${i + 1}/${job.schools.length} - Searching (${school.schoolName})`,
            school
          );

          const outcomeStatus = await this.processOneSchool(job, school, i);
          processedSinceDupCheck++;
          if (processedSinceDupCheck >= 10) {
            processedSinceDupCheck = 0;
            this.detectDuplicates(job);
          }
          jobStore.setJob(job, false);

          const hasNum =
            school.enriched.phone1 !== 'Not Found' || school.enriched.mobileNumber !== 'Not Found';
          const outcomeLabel =
            outcomeStatus === 'Failed'
              ? 'Failed'
              : hasNum
                ? 'Number Found'
                : 'Not Found';

          this.emit(
            job,
            'progress',
            `School ${i + 1}/${job.schools.length} - ${outcomeLabel} (${school.schoolName})`,
            school
          );

          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(workerCount, Math.max(1, queue.length)) }, () => worker())
      );

      this.detectDuplicates(job);

      const finalFlag = this.controlFlags.get(jobId);
      if (finalFlag === 'run') {
        job.status = 'completed';
        job.currentSchoolName = undefined;
        jobStore.setJob(job, true);
        this.emit(job, 'status', 'Batch search completed');
      } else {
        jobStore.setJob(job, true);
      }
    } finally {
      this.activeLoops.delete(jobId);
    }
  }
}

export const batchRunner = new BatchRunner();
