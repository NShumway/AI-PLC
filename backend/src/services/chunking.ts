/**
 * Text Chunking Service
 *
 * Implements recursive character text splitting with overlap to maintain context.
 * Industry standard approach: ~1000 chars/chunk, 200 char overlap, respects sentence boundaries.
 */

export interface TextChunk {
  text: string;
  chunkIndex: number;
}

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Splits text into overlapping chunks while attempting to respect sentence boundaries
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = {}
): TextChunk[] {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap || DEFAULT_CHUNK_OVERLAP;

  if (chunkOverlap >= chunkSize) {
    throw new Error('Chunk overlap must be smaller than chunk size');
  }

  // Normalize whitespace
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  if (normalizedText.length === 0) {
    return [];
  }

  if (normalizedText.length <= chunkSize) {
    return [{ text: normalizedText, chunkIndex: 0 }];
  }

  const chunks: TextChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < normalizedText.length) {
    let endIndex = Math.min(startIndex + chunkSize, normalizedText.length);

    // If not at the end, try to find a sentence boundary
    if (endIndex < normalizedText.length) {
      const remainingText = normalizedText.substring(startIndex, endIndex);

      // Look for sentence endings (. ! ?) followed by space
      const sentenceEndings = ['. ', '! ', '? '];
      let bestBreakpoint = -1;

      for (const ending of sentenceEndings) {
        const lastOccurrence = remainingText.lastIndexOf(ending);
        if (lastOccurrence > chunkSize * 0.5) { // Don't break too early
          bestBreakpoint = Math.max(bestBreakpoint, lastOccurrence + ending.length);
        }
      }

      // If we found a good sentence boundary, use it
      if (bestBreakpoint > -1) {
        endIndex = startIndex + bestBreakpoint;
      }
    }

    const chunkText = normalizedText.substring(startIndex, endIndex).trim();

    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        chunkIndex: chunkIndex++
      });
    }

    // Move start index forward, accounting for overlap
    startIndex = endIndex - chunkOverlap;

    // Ensure we make progress even if overlap is misconfigured
    if (startIndex <= chunks[chunks.length - 1]?.text.length) {
      startIndex = endIndex;
    }
  }

  return chunks;
}

/**
 * Chunks text from multiple pages while maintaining page number metadata
 */
export interface PageText {
  pageNumber: number;
  text: string;
}

export interface PagedChunk extends TextChunk {
  pageNumber: number;
}

export function chunkPagedText(
  pages: PageText[],
  options: ChunkingOptions = {}
): PagedChunk[] {
  const pagedChunks: PagedChunk[] = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    if (!page.text || page.text.trim().length === 0) {
      continue;
    }

    const pageChunks = chunkText(page.text, options);

    for (const chunk of pageChunks) {
      pagedChunks.push({
        text: chunk.text,
        chunkIndex: globalChunkIndex++,
        pageNumber: page.pageNumber
      });
    }
  }

  return pagedChunks;
}
