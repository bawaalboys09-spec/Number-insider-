import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import type {
  ApiReadinessStatus,
  BatchJob,
  ColumnMapping,
  SchoolRecord,
  SearchSettings,
} from './src/types/school.ts';
import { isGeminiConfigured } from './server/aiSearchAndVerify.ts';
import { batchRunner } from './server/batchRunner.ts';
import {
  exportEnrichedCsvString,
  exportEnrichedExcelBuffer,
  parseUploadedSpreadsheet,
} from './server/excel.ts';
import { getGoogleMapsApiKey, getMapsKeyDiagnostic } from './server/mapsPlaces.ts';
import { extractEmailsFromText, normalizeIndianPhone } from './server/phoneUtils.ts';
import { computeBatchStats, jobStore } from './server/store.ts';

const PORT = 3000;

const DEFAULT_SETTINGS: SearchSettings = {
  searchMode: 'all_public',
  includeGoogleMaps: true,
  includeOfficialWebsite: true,
  includePublicSearch: true,
  includeFacebookAndJustdial: true,
  searchMultipleNumbers: true,
  onlyBiharSchools: false,
  districtFilter: '',
  missingNumbersOnly: false,
  recheckFailedOnly: false,
  maxAttemptsPerSchool: 1,
  batchDelayMs: 100,
  concurrency: 8,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload .xlsx, .xls, or .csv.'));
    }
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/readiness', (_req, res) => {
    const status: ApiReadinessStatus = {
      geminiConfigured: isGeminiConfigured(),
      googleMapsConfigured: Boolean(getGoogleMapsApiKey()),
      googleMapsError: getMapsKeyDiagnostic(),
      model: 'gemini-4-hydrogen',
      complianceNotes: [
        'Respects target website robots.txt rules and request rate limits.',
        'Skips CAPTCHA-protected, login-walled, or HTTP 401/403 endpoints.',
        'Never fabricates phone numbers; unverified or missing records are labeled Not Found.',
      ],
    };
    res.json(status);
  });

  app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'File upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No spreadsheet file uploaded' });
      }
      try {
        const requestedSheet =
          typeof req.query.sheet === 'string' && req.query.sheet.trim()
            ? req.query.sheet.trim()
            : typeof (req.body as { sheetName?: string })?.sheetName === 'string'
              ? (req.body as { sheetName?: string }).sheetName
              : undefined;
        const preview = parseUploadedSpreadsheet(req.file.buffer, req.file.originalname, requestedSheet);
        return res.json(preview);
      } catch (parseErr) {
        return res.status(400).json({
          error: parseErr instanceof Error ? parseErr.message : 'Unable to parse spreadsheet',
        });
      }
    });
  });

  app.post('/api/jobs', (req, res) => {
    try {
      const body = req.body as {
        fileName?: string;
        headers?: string[];
        rawRows?: Record<string, string>[];
        columnMapping?: ColumnMapping;
        settings?: Partial<SearchSettings>;
        autoStart?: boolean;
      };

      if (!body.rawRows || !Array.isArray(body.rawRows) || body.rawRows.length === 0) {
        return res.status(400).json({ error: 'Uploaded dataset contains no rows.' });
      }
      if (!body.columnMapping?.schoolName) {
        return res.status(400).json({ error: 'Please map the School Name column before creating a batch.' });
      }

      const map = body.columnMapping;
      const schools: SchoolRecord[] = body.rawRows.map((row, idx) => {
        const schoolName = (row[map.schoolName] || '').trim();
        const sNo = (map.serialNo ? row[map.serialNo] : '') || String(idx + 1);
        const affiliationNumber = map.affiliationNumber ? (row[map.affiliationNumber] || '').trim() : '';
        const schoolCode = map.schoolCode ? (row[map.schoolCode] || '').trim() : '';
        const principalName = map.principalName ? (row[map.principalName] || '').trim() : '';
        const district = map.district ? (row[map.district] || '').trim() : '';
        const state = map.state ? (row[map.state] || '').trim() : '';
        const originalAddress = map.address ? (row[map.address] || '').trim() : '';
        const originalWebsite = map.website ? (row[map.website] || '').trim() : '';
        const cbseDetailsUrl = map.cbseDetailsUrl
          ? (row[map.cbseDetailsUrl] || '').trim()
          : (row['CBSE Details URL'] || row['CBSE Detail URL'] || '').trim();

        const rawExistingPhone = map.existingPhone ? (row[map.existingPhone] || '').trim() : '';
        const normExistingPhone = rawExistingPhone ? normalizeIndianPhone(rawExistingPhone) : null;
        const rawExistingEmail = map.existingEmail ? (row[map.existingEmail] || '').trim() : '';
        const extractedExistingEmail = rawExistingEmail ? extractEmailsFromText(rawExistingEmail)[0] || '' : '';

        return {
          id: crypto.randomUUID(),
          sNo,
          schoolName,
          affiliationNumber,
          schoolCode,
          principalName,
          district,
          state,
          originalAddress,
          originalWebsite,
          cbseDetailsUrl,
          originalRow: row,
          status: schoolName ? 'Pending' : 'Failed',
          attempts: 0,
          errorMessage: schoolName ? undefined : 'Missing school name in uploaded row',
          enriched: {
            address: originalAddress || 'Not Found',
            officialWebsite: originalWebsite || 'Not Found',
            phone1: normExistingPhone?.formatted || 'Not Found',
            phone2: 'Not Found',
            mobileNumber: normExistingPhone?.phoneType === 'mobile' ? normExistingPhone.formatted : 'Not Found',
            emailAddress: extractedExistingEmail || 'Not Found',
            principalContact: 'Not Found',
            sourceUrl: 'Not Found',
            confidenceScore: normExistingPhone ? 70 : 0,
            verificationStatus: normExistingPhone ? 'Unverified' : 'Not Found',
            candidates: [],
          },
        };
      });

      const now = new Date().toISOString();
      const job: BatchJob = {
        id: crypto.randomUUID(),
        fileName: body.fileName || 'uploaded_schools.xlsx',
        createdAt: now,
        updatedAt: now,
        status: 'idle',
        currentIndex: 0,
        columnMapping: map,
        headers: body.headers || [],
        rawRows: body.rawRows,
        settings: { ...DEFAULT_SETTINGS, ...(body.settings || {}) },
        schools,
      };

      jobStore.setJob(job);
      if (body.autoStart) {
        batchRunner.startOrResume(job.id);
      }

      return res.status(201).json({
        job: jobStore.getJob(job.id) || job,
        stats: computeBatchStats(jobStore.getJob(job.id) || job),
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to create batch job',
      });
    }
  });

  app.get('/api/jobs', (_req, res) => {
    res.json({ jobs: jobStore.listSummaries() });
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Batch job not found' });
    return res.json({ job, stats: computeBatchStats(job) });
  });

  app.delete('/api/jobs/:id', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Batch job not found' });
    if (job.status === 'running') {
      batchRunner.stop(job.id);
    }
    jobStore.deleteJob(job.id);
    return res.json({ ok: true });
  });

  app.patch('/api/jobs/:id/settings', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Batch job not found' });
    job.settings = { ...job.settings, ...(req.body as Partial<SearchSettings>) };
    jobStore.setJob(job);
    return res.json({ settings: job.settings });
  });

  app.post('/api/jobs/:id/start', (req, res) => {
    try {
      batchRunner.startOrResume(req.params.id);
      const job = jobStore.getJob(req.params.id)!;
      return res.json({ status: job.status, stats: computeBatchStats(job) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Cannot start batch' });
    }
  });

  app.post('/api/jobs/:id/pause', (req, res) => {
    try {
      batchRunner.pause(req.params.id);
      const job = jobStore.getJob(req.params.id)!;
      return res.json({ status: job.status, stats: computeBatchStats(job) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Cannot pause batch' });
    }
  });

  app.post('/api/jobs/:id/resume', (req, res) => {
    try {
      batchRunner.startOrResume(req.params.id);
      const job = jobStore.getJob(req.params.id)!;
      return res.json({ status: job.status, stats: computeBatchStats(job) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Cannot resume batch' });
    }
  });

  app.post('/api/jobs/:id/stop', (req, res) => {
    try {
      batchRunner.stop(req.params.id);
      const job = jobStore.getJob(req.params.id)!;
      return res.json({ status: job.status, stats: computeBatchStats(job) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Cannot stop batch' });
    }
  });

  app.post('/api/jobs/:id/retry-failed', (req, res) => {
    try {
      batchRunner.retryFailed(req.params.id);
      const job = jobStore.getJob(req.params.id)!;
      return res.json({ status: job.status, stats: computeBatchStats(job) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Cannot retry failed schools' });
    }
  });

  app.post('/api/jobs/:id/schools/:schoolId/retry', async (req, res) => {
    try {
      const updated = await batchRunner.retrySingleSchool(req.params.id, req.params.schoolId);
      const job = jobStore.getJob(req.params.id)!;
      return res.json({ school: updated, stats: computeBatchStats(job) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Retry failed' });
    }
  });

  app.get('/api/jobs/:id/stream', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const initialPayload = JSON.stringify({
      type: 'status',
      jobId: job.id,
      jobStatus: job.status,
      currentIndex: job.currentIndex,
      currentSchoolName: job.currentSchoolName,
      message: `Connected (${job.status})`,
      stats: computeBatchStats(job),
    });
    res.write(`data: ${initialPayload}\n\n`);

    const unsubscribe = batchRunner.subscribe(job.id, (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    req.on('close', () => {
      unsubscribe();
    });
  });

  app.get('/api/jobs/:id/export/xlsx', async (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Batch job not found' });
    try {
      const format = req.query.format === 'original' ? 'original' : 'standard';
      const buffer = await exportEnrichedExcelBuffer(job, format);
      const baseName = path.parse(job.fileName).name.replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}_enriched.xlsx"`);
      return res.send(buffer);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate Excel file',
      });
    }
  });

  app.get('/api/jobs/:id/export/csv', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Batch job not found' });
    const format = req.query.format === 'original' ? 'original' : 'standard';
    const csv = exportEnrichedCsvString(job, format);
    const baseName = path.parse(job.fileName).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}_enriched.csv"`);
    return res.send(csv);
  });

  // Frontend serving: Vite middleware in development, static dist/ in production
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distPath)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`School Contact Finder AI running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
