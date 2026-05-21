/**
 * gemini_research - Web Research Delegation Tool
 *
 * Delegates web research, documentation lookup, and information gathering
 * to Gemini's large context window.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGemini, buildPrompt, parseGeminiJson } from '../gemini-cli.js';
import {
  validateResearchOutput,
  assertString,
  assertOptionalEnum,
  assertOptionalStringArray,
  assertOptionalNumber,
} from '../validation.js';

export const researchTool: Tool = {
  name: 'gemini_research',
  description: `Delegate web research and documentation lookup to Gemini (2M token context).
Use when:
- Deep research requiring multiple sources
- Documentation analysis across frameworks
- Comparative analysis of technologies
- Finding patterns across large documentation sets

Returns structured findings with sources for Claude to validate.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Research query or question to investigate',
      },
      depth: {
        type: 'string',
        enum: ['shallow', 'medium', 'deep'],
        description:
          'Research depth: shallow (quick facts), medium (analysis), deep (comprehensive)',
        default: 'medium',
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific sources or domains to focus on (optional)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of findings to return',
        default: 10,
      },
      model: {
        type: 'string',
        enum: ['flash', 'pro', 'auto'],
        description: "Gemini model tier. 'auto' (default for research) routes to flash.",
      },
      timeout_ms: {
        type: 'number',
        description: 'Override the per-call timeout in milliseconds.',
      },
    },
    required: ['query'],
  },
};

interface ResearchOutput {
  query: string;
  depth: string;
  findings: Array<{
    title: string;
    content: string;
    relevance: 'high' | 'medium' | 'low';
  }>;
  sources: string[];
  summary: string;
  confidence: number;
}

export async function handleResearch(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Input validation + model knob added 2026-05-21.
  const query = assertString(args, 'query');
  const depth = assertOptionalEnum(args, 'depth', ['shallow', 'medium', 'deep'] as const);
  const sources = assertOptionalStringArray(args, 'sources');
  const maxResults = assertOptionalNumber(args, 'max_results', { min: 1, max: 100 });
  const model = assertOptionalEnum(args, 'model', ['flash', 'pro', 'auto'] as const);
  const timeoutMs = assertOptionalNumber(args, 'timeout_ms', { min: 1000 });

  const prompt = buildPrompt(
    `Research the following query and provide comprehensive findings:

"${query}"

Depth level: ${depth || 'medium'}
${sources ? `Focus on these sources: ${sources.join(', ')}` : ''}
${maxResults ? `Return up to ${maxResults} findings` : ''}`,
    {},
    `Return a JSON object with this structure:
{
  "query": "the original query",
  "depth": "the depth level used",
  "findings": [
    {
      "title": "finding title",
      "content": "detailed content",
      "relevance": "high|medium|low"
    }
  ],
  "sources": ["source urls or references"],
  "summary": "executive summary of findings",
  "confidence": 0.0-1.0
}`
  );

  // Per IMPROVEMENT_NOTES (2026-04-27): cold research calls > 2KB prompt
  // observed timing out at 120s; 240s eliminates that without architecture changes.
  const result = await executeGemini(prompt, {
    tool: 'gemini_research',
    input: args,
    timeout_ms: timeoutMs ?? 240000,
    model,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      session_id: result.session_id,
      needs_continue: result.needs_continue,
    };
  }

  const parsed = parseGeminiJson<ResearchOutput>(result.output);

  if (!parsed) {
    return {
      success: true,
      raw_output: result.output,
      warning: 'Could not parse structured output - returning raw',
      session_id: result.session_id,
    };
  }

  // Validate output
  const validation = validateResearchOutput(parsed as unknown as Record<string, unknown>);

  return {
    success: true,
    ...parsed,
    validation,
    session_id: result.session_id,
  };
}
