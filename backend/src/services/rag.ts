import OpenAI from 'openai';
import { searchSimilarDocuments, hasDocuments } from './vectorSearch';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.5');

interface Citation {
  book_title: string;
  page_number: number;
}

interface RAGResponse {
  answer: string;
  citations: Citation[];
  hasRelevantDocs: boolean;
}

/**
 * Process a user query using RAG (Retrieval Augmented Generation)
 * This function ONLY uses information from the vector database, not general knowledge
 */
export async function processQuery(
  query: string,
  topicId?: string
): Promise<RAGResponse> {
  try {
    // First, check if we have any documents in the database
    const hasAnyDocs = await hasDocuments();

    if (!hasAnyDocs) {
      return {
        answer: "I apologize, but I don't have any documents in my knowledge base yet. I can only answer questions based on the PLC course materials that have been uploaded to my system. Please check back once documents have been added.",
        citations: [],
        hasRelevantDocs: false
      };
    }

    // Search for relevant document chunks
    const searchResults = await searchSimilarDocuments(query, topicId, 5);

    // Filter results by similarity threshold
    const relevantDocs = searchResults.filter(
      result => result.distance <= SIMILARITY_THRESHOLD
    );

    if (relevantDocs.length === 0) {
      return {
        answer: "I apologize, but I couldn't find any relevant information in my knowledge base to answer your question. I can only provide answers based on the PLC course materials that have been uploaded. Please try rephrasing your question or ask about a different topic covered in the materials.",
        citations: [],
        hasRelevantDocs: false
      };
    }

    // Build context from relevant documents
    const context = relevantDocs
      .map((doc, index) =>
        `[Source ${index + 1}: ${doc.metadata.book_title}, Page ${doc.metadata.page_number}]\n${doc.text}`
      )
      .join('\n\n---\n\n');

    // Create citations list (unique books and pages)
    const citationsMap = new Map<string, Citation>();
    relevantDocs.forEach(doc => {
      const key = `${doc.metadata.book_title}-${doc.metadata.page_number}`;
      if (!citationsMap.has(key)) {
        citationsMap.set(key, {
          book_title: doc.metadata.book_title,
          page_number: doc.metadata.page_number
        });
      }
    });
    const citations = Array.from(citationsMap.values());

    // Generate response using OpenAI with strict instructions
    const systemPrompt = `You are an AI assistant for a PLC (Programmable Logic Controller) educational platform.

CRITICAL INSTRUCTIONS:
1. You MUST ONLY answer questions using the information provided in the context below
2. DO NOT use any general knowledge or information from your training data
3. If the context doesn't contain enough information to answer the question, you MUST say so
4. Always cite specific sources when providing information
5. Be concise and educational in your responses
6. If the user's question cannot be answered from the provided context, politely explain that you don't have that information in the course materials

Context from PLC course materials:
${context}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: query
        }
      ],
      temperature: 0.3, // Lower temperature for more focused, factual responses
      max_tokens: 1000
    });

    const answer = completion.choices[0]?.message?.content ||
      "I apologize, but I encountered an error generating a response.";

    return {
      answer,
      citations,
      hasRelevantDocs: true
    };

  } catch (error) {
    console.error('Error processing query with RAG:', error);
    throw error;
  }
}

/**
 * Validate that a message should be processed
 * (Basic validation, can be expanded)
 */
export function validateQuery(query: string): { valid: boolean; error?: string } {
  if (!query || query.trim().length === 0) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  if (query.length > 2000) {
    return { valid: false, error: 'Query is too long (max 2000 characters)' };
  }

  return { valid: true };
}
