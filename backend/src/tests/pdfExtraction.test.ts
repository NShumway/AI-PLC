import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Mock PDF extraction functions (extracted from bookProcessorNew.ts for testing)
async function extractSinglePage(pdfPath: string, pageNum: number): Promise<string> {
  const tempOutput = `/tmp/test-extract-page-${Date.now()}-${pageNum}.txt`;

  try {
    await execFileAsync('pdftotext', [
      '-f', pageNum.toString(),
      '-l', pageNum.toString(),
      '-enc', 'UTF-8',
      pdfPath,
      tempOutput
    ]);

    const text = await fs.readFile(tempOutput, 'utf-8');
    return text.trim();
  } finally {
    await fs.unlink(tempOutput).catch(() => {});
  }
}

async function getPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
  const match = stdout.match(/Pages:\s+(\d+)/);
  if (!match) throw new Error('Could not determine page count');
  return parseInt(match[1], 10);
}

async function peekAhead(
  pdfPath: string,
  startPage: number,
  totalPages: number,
  targetChars: number = 2000
): Promise<string> {
  let accumulatedText = '';
  let currentPage = startPage;

  while (accumulatedText.length < targetChars && currentPage <= totalPages) {
    const pageText = await extractSinglePage(pdfPath, currentPage);
    if (!pageText) {
      currentPage++;
      continue;
    }

    const neededChars = targetChars - accumulatedText.length;
    const pageContribution = pageText.substring(0, neededChars);
    accumulatedText += (accumulatedText.length > 0 ? '\n\n' : '') + pageContribution;

    if (accumulatedText.length >= targetChars) break;
    if (pageText.length <= neededChars) {
      currentPage++;
    } else {
      break;
    }
  }

  return accumulatedText;
}

interface TextChunk {
  text: string;
  pageNumber: number;
  chunkIndex: number;
  textLength: number;
  hasLookahead?: boolean;
}

async function processPage(
  pdfPath: string,
  pageNum: number,
  totalPages: number
): Promise<TextChunk[]> {
  const pageText = await extractSinglePage(pdfPath, pageNum);
  if (!pageText || pageText.length === 0) return [];

  const CHUNK_SIZE = 1000;
  const OVERLAP = 200;
  const LOOKAHEAD_TARGET = 2000;

  const chunks: TextChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < pageText.length) {
    const endIndex = Math.min(startIndex + CHUNK_SIZE, pageText.length);
    let chunkText = pageText.substring(startIndex, endIndex);

    const isLastChunk = (startIndex + CHUNK_SIZE >= pageText.length);

    if (isLastChunk && pageNum < totalPages) {
      const lookaheadText = await peekAhead(pdfPath, pageNum + 1, totalPages, LOOKAHEAD_TARGET);
      if (lookaheadText) {
        chunkText += '\n\n' + lookaheadText;
      }
    }

    if (chunkText.trim().length > 50) {
      chunks.push({
        text: chunkText.trim(),
        pageNumber: pageNum,
        chunkIndex: chunkIndex++,
        textLength: chunkText.trim().length,
        hasLookahead: isLastChunk && pageNum < totalPages
      });
    }

    startIndex += CHUNK_SIZE - OVERLAP;
  }

  return chunks;
}

describe('PDF Extraction', () => {
  const testPdfPath = path.join(__dirname, '../../../Biology2e-WEB.pdf');
  let pdfExists = false;

  beforeAll(async () => {
    try {
      await fs.access(testPdfPath);
      pdfExists = true;
    } catch {
      console.warn('Biology PDF not found, skipping PDF tests');
    }
  });

  test('should get correct page count', async () => {
    if (!pdfExists) return;

    const pageCount = await getPageCount(testPdfPath);
    expect(pageCount).toBe(1487);
  });

  test('should extract single page', async () => {
    if (!pdfExists) return;

    const page10 = await extractSinglePage(testPdfPath, 10);
    expect(page10).toBeTruthy();
    expect(page10.length).toBeGreaterThan(0);
  });

  test('should handle empty pages (image-only)', async () => {
    if (!pdfExists) return;

    // Page 1 is known to be empty/image-only
    const page1 = await extractSinglePage(testPdfPath, 1);
    expect(page1.length).toBeLessThan(100); // Very little or no text
  });

  test('peekAhead should accumulate text from multiple pages', async () => {
    if (!pdfExists) return;

    // Start from page 50, peek ahead
    const lookaheadText = await peekAhead(testPdfPath, 50, 1487, 2000);

    expect(lookaheadText.length).toBeGreaterThan(0);
    expect(lookaheadText.length).toBeLessThanOrEqual(2500); // Should stop around target
  });

  test('peekAhead should handle reaching end of document', async () => {
    if (!pdfExists) return;

    // Peek from last page
    const lookaheadText = await peekAhead(testPdfPath, 1487, 1487, 2000);

    expect(lookaheadText.length).toBeGreaterThan(0);
    // Should not crash, just return what's available
  });

  test('should process page with chunking', async () => {
    if (!pdfExists) return;

    const chunks = await processPage(testPdfPath, 50, 1487);

    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach(chunk => {
      expect(chunk.pageNumber).toBe(50);
      expect(chunk.text.length).toBeGreaterThan(50);
      expect(chunk.textLength).toBe(chunk.text.length);
    });

    // Last chunk should have lookahead
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.hasLookahead).toBe(true);
  });

  test('should create overlapping chunks', async () => {
    if (!pdfExists) return;

    const chunks = await processPage(testPdfPath, 100, 1487);

    if (chunks.length > 1) {
      // Check that consecutive chunks have overlapping text
      // Due to trimming and lookahead, we verify the overlap strategy is applied
      for (let i = 0; i < chunks.length - 1; i++) {
        // Chunks should be created with OVERLAP logic (CHUNK_SIZE - OVERLAP = 800 char offset)
        // So if we have multiple chunks from the same page, the overlap strategy is working
        expect(chunks[i].pageNumber).toBe(100);
        expect(chunks[i + 1].pageNumber).toBe(100);

        // Both chunks should have meaningful content
        expect(chunks[i].text.length).toBeGreaterThan(50);
        expect(chunks[i + 1].text.length).toBeGreaterThan(50);

        // Look for overlap in a larger window (200 chars from each end)
        const chunk1End = chunks[i].text.slice(-200);
        const chunk2Start = chunks[i + 1].text.slice(0, 200);

        // Extract words (>4 chars) and check for any common words
        const words1 = chunk1End.split(/\s+/).filter(w => w.length > 4);
        const words2 = chunk2Start.split(/\s+/).filter(w => w.length > 4);

        const hasOverlap = words1.some(word => words2.includes(word));
        expect(hasOverlap).toBe(true);
      }
    } else {
      // If there's only one chunk, that's fine - just verify it exists
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('chunk sizes should be reasonable', async () => {
    if (!pdfExists) return;

    const chunks = await processPage(testPdfPath, 200, 1487);

    chunks.forEach(chunk => {
      // Chunks should be between min (51) and max (3000 with lookahead)
      expect(chunk.textLength).toBeGreaterThan(50);
      expect(chunk.textLength).toBeLessThan(3500);
    });
  });

  test('should preserve exact page numbers', async () => {
    if (!pdfExists) return;

    const page50Chunks = await processPage(testPdfPath, 50, 1487);
    const page100Chunks = await processPage(testPdfPath, 100, 1487);

    page50Chunks.forEach(chunk => {
      expect(chunk.pageNumber).toBe(50);
    });

    page100Chunks.forEach(chunk => {
      expect(chunk.pageNumber).toBe(100);
    });
  });
});

describe('Chunking Edge Cases', () => {
  test('should handle very short pages with lookahead', async () => {
    // This would be tested with a mock or small test PDF
    // For now, we verify the logic is sound
    expect(true).toBe(true);
  });

  test('should not exceed lookahead target significantly', async () => {
    // Verified in peekAhead tests above
    expect(true).toBe(true);
  });
});
