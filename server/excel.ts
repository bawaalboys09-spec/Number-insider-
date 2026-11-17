import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type { BatchJob, ColumnMapping, ParsedUploadPreview } from '../src/types/school.ts';

const COLUMN_ALIASES: Record<keyof ColumnMapping, string[]> = {
  serialNo: ['s.no', 'sno', 's no', 'sr no', 'sr.no', 'sr', 'sl no', 'sl.no', 'sl', 'serial no', 'serial number', 'serial', 'no.', '#'],
  schoolName: [
    'school name',
    'school name (source field)',
    'name of school',
    'name of the school',
    'institution name',
    'school_name',
    'school title',
    'sch name',
    'institution',
    'school',
  ],
  affiliationNumber: [
    'affiliation number',
    'affiliation no.',
    'affiliation no',
    'affiliation',
    'aff no',
    'aff. no',
    'affno',
    'cbse affiliation',
    'affiliation_number',
    'reg no',
    'registration no',
  ],
  schoolCode: ['school code', 'sch code', 'school_code', 'udise code', 'udise+', 'udise', 'dise code', 'cbse code', 'code'],
  principalName: ['principal name', 'principal', 'headmaster', 'head mistress', 'head of school', 'director', 'hm name'],
  district: ['district', 'district name', 'distt', 'dist', 'city', 'town', 'block'],
  state: ['state', 'state name', 'province', 'region'],
  address: ['address', 'full address', 'school address', 'postal address', 'location', 'street'],
  website: ['website', 'official website', 'school website', 'web', 'url', 'site', 'domain', 'homepage'],
  cbseDetailsUrl: ['cbse details url', 'cbse detail url', 'cbse url', 'saras url', 'affiliation details url', 'details url'],
  existingPhone: ['contact number', 'phone number', 'phone number 1', 'phone', 'mobile number', 'mobile', 'contact no', 'tel', 'telephone'],
  existingEmail: ['email address', 'email', 'e-mail', 'mail', 'official email', 'school email'],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function autoDetectColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    serialNo: '',
    schoolName: '',
    affiliationNumber: '',
    schoolCode: '',
    principalName: '',
    district: '',
    state: '',
    address: '',
    website: '',
    cbseDetailsUrl: '',
    existingPhone: '',
    existingEmail: '',
  };

  const usedHeaders = new Set<string>();
  const fields = Object.keys(COLUMN_ALIASES) as Array<keyof ColumnMapping>;

  // Pass 1: Exact normalized match across ALL fields first
  for (const field of fields) {
    const aliases = COLUMN_ALIASES[field];
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const norm = normalizeHeader(header);
      if (aliases.includes(norm)) {
        mapping[field] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  // Pass 2: Specific substring match across remaining unmapped fields
  for (const field of fields) {
    if (mapping[field]) continue;
    const aliases = COLUMN_ALIASES[field];
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const norm = normalizeHeader(header);
      if (field === 'website' && norm.includes('cbse')) continue;
      if (field === 'schoolName' && (norm.includes('code') || norm.includes('type') || norm.includes('category'))) continue;
      if (aliases.some((alias) => norm.includes(alias))) {
        mapping[field] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  // Pass 3: Fallback for schoolName if still unmapped
  if (!mapping.schoolName) {
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const norm = normalizeHeader(header);
      if ((norm.includes('school') && !norm.includes('code') && !norm.includes('level')) || norm === 'name') {
        mapping.schoolName = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  return mapping;
}

const HEADER_HINT_TOKENS = [
  'school',
  'name',
  'district',
  'dist',
  'state',
  'address',
  'website',
  'url',
  'affiliation',
  'code',
  'udise',
  'principal',
  's.no',
  'sno',
  'sr',
  'phone',
  'contact',
  'mobile',
  'email',
];

function scoreHeaderRow(cells: unknown[]): number {
  const nonEmpty = cells.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (nonEmpty.length < 2) return 0;
  let score = nonEmpty.length;
  for (const cell of nonEmpty) {
    const lower = cell.toLowerCase();
    if (lower.length > 60) continue; // long sentence / banner title, not a column header
    if (HEADER_HINT_TOKENS.some((tok) => lower.includes(tok))) {
      score += 6;
    }
    if (/^\d+$/.test(cell)) {
      score -= 3; // data row with pure numbers
    }
  }
  return score;
}

function extractSheetRows(sheet: XLSX.WorkSheet): {
  headerRowIndex: number;
  headers: string[];
  rawRows: Record<string, string>[];
} {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (matrix.length === 0) {
    return { headerRowIndex: 0, headers: [], rawRows: [] };
  }

  let bestRowIdx = 0;
  let bestScore = -1;
  const maxScan = Math.min(12, matrix.length);
  for (let r = 0; r < maxScan; r++) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    const s = scoreHeaderRow(row);
    if (s > bestScore) {
      bestScore = s;
      bestRowIdx = r;
    }
  }

  const rawHeaderRow = Array.isArray(matrix[bestRowIdx]) ? matrix[bestRowIdx] : [];
  const colPositions: Array<{ colIdx: number; header: string }> = [];
  const usedNames = new Map<string, number>();

  for (let c = 0; c < rawHeaderRow.length; c++) {
    const base = String(rawHeaderRow[c] ?? '').replace(/\s+/g, ' ').trim();
    if (!base) continue;
    const count = usedNames.get(base) || 0;
    usedNames.set(base, count + 1);
    const headerName = count === 0 ? base : `${base} (${count + 1})`;
    colPositions.push({ colIdx: c, header: headerName });
  }

  const headers = colPositions.map((p) => p.header);
  const rawRows: Record<string, string>[] = [];

  for (let r = bestRowIdx + 1; r < matrix.length; r++) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    const record: Record<string, string> = {};
    let hasValue = false;
    for (const { colIdx, header } of colPositions) {
      const val = row[colIdx];
      const cleaned = val === null || val === undefined ? '' : String(val).replace(/\r?\n/g, ' ').trim();
      if (cleaned) hasValue = true;
      record[header] = cleaned;
    }
    if (hasValue) {
      rawRows.push(record);
    }
  }

  return { headerRowIndex: bestRowIdx + 1, headers, rawRows };
}

export function parseUploadedSpreadsheet(
  buffer: Buffer,
  fileName: string,
  requestedSheet?: string
): ParsedUploadPreview {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new Error('Invalid or corrupted Excel/CSV file. Please upload a valid .xlsx, .xls, or .csv file.');
  }

  const sheetNames = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    throw new Error('The uploaded spreadsheet contains no worksheets.');
  }

  let selectedSheet = requestedSheet && sheetNames.includes(requestedSheet) ? requestedSheet : sheetNames[0];
  let parsed = extractSheetRows(workbook.Sheets[selectedSheet]);

  // If the first sheet is empty/summary and user didn't force a sheet, auto-pick the richest data sheet
  if (!requestedSheet && sheetNames.length > 1) {
    let bestSheet = selectedSheet;
    let bestParsed = parsed;
    let bestRank = parsed.rawRows.length * (parsed.headers.length > 0 ? 1 : 0);

    for (const name of sheetNames) {
      const candidate = extractSheetRows(workbook.Sheets[name]);
      const mapping = autoDetectColumnMapping(candidate.headers);
      const rank = candidate.rawRows.length + (mapping.schoolName ? 500 : 0);
      if (candidate.rawRows.length > 0 && rank > bestRank) {
        bestRank = rank;
        bestSheet = name;
        bestParsed = candidate;
      }
    }
    selectedSheet = bestSheet;
    parsed = bestParsed;
  }

  if (parsed.headers.length === 0) {
    throw new Error('No recognizable column headers found in this spreadsheet.');
  }
  if (parsed.rawRows.length === 0) {
    throw new Error('The selected worksheet has headers but no data rows.');
  }

  const detectedMapping = autoDetectColumnMapping(parsed.headers);

  return {
    fileName,
    sheetNames,
    selectedSheet,
    detectedHeaderRow: parsed.headerRowIndex,
    headers: parsed.headers,
    detectedMapping,
    rowCount: parsed.rawRows.length,
    sampleRows: parsed.rawRows.slice(0, 8),
    rawRows: parsed.rawRows,
  };
}

export const EXPORT_COLUMNS = [
  'S.No.',
  'School Name',
  'Affiliation Number',
  'School Code',
  'District',
  'State',
  'Address',
  'Official Website',
  'Phone Number 1',
  'Phone Number 2',
  'Mobile Number',
  'Email Address',
  'Principal Contact',
  'Source URL',
  'Confidence Score',
  'Verification Status',
] as const;

export function buildExportRow(school: BatchJob['schools'][number]) {
  return {
    'S.No.': school.sNo,
    'School Name': school.schoolName,
    'Affiliation Number': school.affiliationNumber || 'Not Found',
    'School Code': school.schoolCode || 'Not Found',
    District: school.district || 'Not Found',
    State: school.state || 'Not Found',
    Address: school.enriched.address !== 'Not Found' ? school.enriched.address : school.originalAddress || 'Not Found',
    'Official Website':
      school.enriched.officialWebsite !== 'Not Found'
        ? school.enriched.officialWebsite
        : school.originalWebsite || 'Not Found',
    'Phone Number 1': school.enriched.phone1 || 'Not Found',
    'Phone Number 2': school.enriched.phone2 || 'Not Found',
    'Mobile Number': school.enriched.mobileNumber || 'Not Found',
    'Email Address': school.enriched.emailAddress || 'Not Found',
    'Principal Contact': school.enriched.principalContact || 'Not Found',
    'Source URL': school.enriched.sourceUrl || 'Not Found',
    'Confidence Score': school.enriched.confidenceScore > 0 ? `${school.enriched.confidenceScore}%` : '0%',
    'Verification Status': school.enriched.verificationStatus || 'Not Found',
  };
}

export async function exportEnrichedExcelBuffer(
  job: BatchJob,
  format: 'standard' | 'original' = 'standard'
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'School Contact Finder AI';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Enriched School Contacts', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  if (format === 'original' && job.headers.length > 0) {
    const appendedCols = [
      'Contact Number',
      'Phone Number 2',
      'Mobile Number',
      'Email Address',
      'Source URL',
      'Confidence Score',
      'Verification Status',
    ];
    const allHeaders = [
      ...job.headers,
      ...appendedCols.filter((c) => !job.headers.includes(c)),
    ];

    sheet.columns = allHeaders.map((h) => ({
      header: h,
      key: h,
      width: h === 'S.No.' ? 8 : h.includes('Address') || h.includes('URL') ? 38 : h.includes('School') ? 32 : 20,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    const highlightKeys = new Set(['Contact Number', 'Phone Number 2', 'Mobile Number', 'Email Address', 'Verification Status']);

    for (const school of job.schools) {
      const rowData: Record<string, string> = { ...school.originalRow };
      rowData['Contact Number'] = school.enriched.phone1 || 'Not Found';
      rowData['Phone Number 2'] = school.enriched.phone2 || 'Not Found';
      rowData['Mobile Number'] = school.enriched.mobileNumber || 'Not Found';
      rowData['Email Address'] = school.enriched.emailAddress || 'Not Found';
      rowData['Source URL'] = school.enriched.sourceUrl || 'Not Found';
      rowData['Confidence Score'] = school.enriched.confidenceScore > 0 ? `${school.enriched.confidenceScore}%` : '0%';
      rowData['Verification Status'] = school.enriched.verificationStatus || 'Not Found';

      const addedRow = sheet.addRow(rowData);
      addedRow.height = 22;
      const status = school.enriched.verificationStatus;

      addedRow.eachCell((cell, colNumber) => {
        const key = allHeaders[colNumber - 1];
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        const val = String(cell.value ?? '');
        if (highlightKeys.has(key) && val !== 'Not Found') {
          if (status === 'Verified') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
            cell.font = { color: { argb: 'FF166534' }, bold: key === 'Verification Status' };
          } else if (status === 'Unverified') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
            cell.font = { color: { argb: 'FF854D0E' }, bold: key === 'Verification Status' };
          }
        } else if (val === 'Not Found') {
          cell.font = { color: { argb: 'FF94A3B8' }, italic: true };
        }
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  sheet.columns = [
    { header: 'S.No.', key: 'S.No.', width: 8 },
    { header: 'School Name', key: 'School Name', width: 34 },
    { header: 'Affiliation Number', key: 'Affiliation Number', width: 18 },
    { header: 'School Code', key: 'School Code', width: 14 },
    { header: 'District', key: 'District', width: 18 },
    { header: 'State', key: 'State', width: 14 },
    { header: 'Address', key: 'Address', width: 42 },
    { header: 'Official Website', key: 'Official Website', width: 30 },
    { header: 'Phone Number 1', key: 'Phone Number 1', width: 18 },
    { header: 'Phone Number 2', key: 'Phone Number 2', width: 18 },
    { header: 'Mobile Number', key: 'Mobile Number', width: 18 },
    { header: 'Email Address', key: 'Email Address', width: 28 },
    { header: 'Principal Contact', key: 'Principal Contact', width: 18 },
    { header: 'Source URL', key: 'Source URL', width: 38 },
    { header: 'Confidence Score', key: 'Confidence Score', width: 16 },
    { header: 'Verification Status', key: 'Verification Status', width: 18 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0284C7' },
    };
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF0369A1' } },
    };
  });

  const highlightColumns = [9, 10, 11, 12, 13, 16]; // Phone 1, Phone 2, Mobile, Email, Principal, Status

  for (const school of job.schools) {
    const rowValues = buildExportRow(school);
    const addedRow = sheet.addRow(rowValues);
    addedRow.height = 22;

    const status = school.enriched.verificationStatus;
    addedRow.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 || colNumber === 15 ? 'center' : 'left' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };

      const val = String(cell.value ?? '');
      if (highlightColumns.includes(colNumber) && val !== 'Not Found') {
        if (status === 'Verified') {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDCFCE7' },
          };
          cell.font = { color: { argb: 'FF166534' }, bold: colNumber === 16 };
        } else if (status === 'Unverified') {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEF9C3' },
          };
          cell.font = { color: { argb: 'FF854D0E' }, bold: colNumber === 16 };
        }
      } else if (val === 'Not Found') {
        cell.font = { color: { argb: 'FF94A3B8' }, italic: true };
      }
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function exportEnrichedCsvString(
  job: BatchJob,
  format: 'standard' | 'original' = 'standard'
): string {
  const escapeCell = (value: unknown) => {
    const str = String(value ?? '');
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  if (format === 'original' && job.headers.length > 0) {
    const appendedCols = [
      'Contact Number',
      'Phone Number 2',
      'Mobile Number',
      'Email Address',
      'Source URL',
      'Confidence Score',
      'Verification Status',
    ];
    const allHeaders = [
      ...job.headers,
      ...appendedCols.filter((c) => !job.headers.includes(c)),
    ];

    const lines = [
      allHeaders.map(escapeCell).join(','),
      ...job.schools.map((school) => {
        const rowData: Record<string, string> = {
          ...school.originalRow,
          'Contact Number': school.enriched.phone1 || 'Not Found',
          'Phone Number 2': school.enriched.phone2 || 'Not Found',
          'Mobile Number': school.enriched.mobileNumber || 'Not Found',
          'Email Address': school.enriched.emailAddress || 'Not Found',
          'Source URL': school.enriched.sourceUrl || 'Not Found',
          'Confidence Score': school.enriched.confidenceScore > 0 ? `${school.enriched.confidenceScore}%` : '0%',
          'Verification Status': school.enriched.verificationStatus || 'Not Found',
        };
        return allHeaders.map((col) => escapeCell(rowData[col])).join(',');
      }),
    ];
    return lines.join('\r\n');
  }

  const rows = job.schools.map((s) => buildExportRow(s));
  const lines = [
    EXPORT_COLUMNS.join(','),
    ...rows.map((r) => EXPORT_COLUMNS.map((col) => escapeCell(r[col])).join(',')),
  ];
  return lines.join('\r\n');
}
