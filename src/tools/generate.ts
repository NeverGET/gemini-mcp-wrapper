/**
 * gemini_generate - Multi-File Code Generation Tool
 *
 * Delegates generation of multiple files (>5) to Gemini.
 * Includes pattern validation and style compliance.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGemini, buildPrompt, parseGeminiJson } from '../gemini-cli.js';
import {
  validateCodeBlocks,
  validateFileList,
  assertString,
  assertOptionalString,
  assertOptionalEnum,
  assertOptionalNumber,
  assertObjectArray,
  assertOptionalRecord,
  InputError,
} from '../validation.js';

export const generateTool: Tool = {
  name: 'gemini_generate',
  description: `Generate multiple files (>5) using Gemini's large context.
Use when:
- Scaffolding new features with multiple files
- Generating boilerplate across components
- Creating test suites for existing code
- Bulk file creation from templates

Claude validates syntax and pattern compliance before accepting.`,
  inputSchema: {
    type: 'object',
    properties: {
      spec: {
        type: 'string',
        description: 'Specification describing what to generate',
      },
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Target file path' },
            description: { type: 'string', description: 'What this file should contain' },
          },
          required: ['path', 'description'],
        },
        description: 'List of files to generate',
      },
      templates: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Template patterns to follow (optional)',
      },
      style_guide: {
        type: 'string',
        description: 'Coding style guidelines to follow',
      },
      model: {
        type: 'string',
        enum: ['flash', 'pro', 'auto'],
        description: "Gemini model tier. 'auto' (default for generate) routes to flash.",
      },
      timeout_ms: {
        type: 'number',
        description: 'Override the per-call timeout in milliseconds.',
      },
    },
    required: ['spec', 'files'],
  },
};

interface GeneratedFile {
  path: string;
  content: string;
  language: string;
  description: string;
}

interface GenerateOutput {
  spec: string;
  generated_files: GeneratedFile[];
  summary: string;
  dependencies_added?: string[];
  notes?: string[];
}

export async function handleGenerate(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Input validation + model knob added 2026-05-21.
  // Closes Bug B' (`input.files.map()` on line 76 of the pre-fix file)
  // by validating files is a non-empty object array of {path, description}.
  const spec = assertString(args, 'spec');
  const files = assertObjectArray(
    args,
    'files',
    (item, idx) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new InputError(`files[${idx}]`, 'object with {path, description}', item);
      }
      const f = item as Record<string, unknown>;
      const path = f.path;
      const description = f.description;
      if (typeof path !== 'string' || path.length === 0) {
        throw new InputError(`files[${idx}].path`, 'non-empty string', path);
      }
      if (typeof description !== 'string' || description.length === 0) {
        throw new InputError(`files[${idx}].description`, 'non-empty string', description);
      }
      return { path, description };
    },
    { minLen: 1 }
  );
  const templates = assertOptionalRecord(args, 'templates');
  const styleGuide = assertOptionalString(args, 'style_guide');
  const model = assertOptionalEnum(args, 'model', ['flash', 'pro', 'auto'] as const);
  const timeoutMs = assertOptionalNumber(args, 'timeout_ms', { min: 1000 });

  const fileList = files.map((f) => `- ${f.path}: ${f.description}`).join('\n');

  const prompt = buildPrompt(
    `Generate the following files based on this specification:

## Specification
${spec}

## Files to Generate
${fileList}

${styleGuide ? `## Style Guide\n${styleGuide}` : ''}
${templates ? `## Templates to Follow\n${JSON.stringify(templates, null, 2)}` : ''}

Generate complete, production-ready code for each file.
Follow best practices and the provided style guide.
Include proper imports, exports, and documentation.`,
    {},
    `Return a JSON object with this structure:
{
  "spec": "brief summary of the spec",
  "generated_files": [
    {
      "path": "path/to/file.ts",
      "content": "full file content",
      "language": "typescript",
      "description": "what this file does"
    }
  ],
  "summary": "overview of what was generated",
  "dependencies_added": ["any new dependencies needed"],
  "notes": ["implementation notes or warnings"]
}`
  );

  const result = await executeGemini(prompt, {
    tool: 'gemini_generate',
    input: args,
    timeout_ms: timeoutMs ?? 300000, // 5 min for generation
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

  const parsed = parseGeminiJson<GenerateOutput>(result.output);

  if (!parsed) {
    return {
      success: true,
      raw_output: result.output,
      warning: 'Could not parse structured output - returning raw',
      session_id: result.session_id,
    };
  }

  // Validate generated files
  const requestedPaths = files.map((f) => f.path);
  const fileValidation = validateFileList({ files: parsed.generated_files }, requestedPaths);

  // Validate code blocks in each file
  const codeValidations = parsed.generated_files.map((file) => validateCodeBlocks(file.content));

  const allValid = codeValidations.every((v) => v.valid);
  const allWarnings = codeValidations.flatMap((v) => v.warnings);

  return {
    success: true,
    ...parsed,
    validation: {
      files: fileValidation,
      code: {
        valid: allValid,
        warnings: allWarnings,
      },
    },
    session_id: result.session_id,
  };
}
