/**
 * gemini_test - Test Suite Execution/Generation Tool
 *
 * Delegates test execution and generation to Gemini.
 * Handles bulk test runs and test file generation.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGemini, buildPrompt, parseGeminiJson } from '../gemini-cli.js';
import {
  validateTestOutput,
  assertString,
  assertEnum,
  assertOptionalEnum,
  assertOptionalNumber,
  assertOptionalBoolean,
} from '../validation.js';

export const testTool: Tool = {
  name: 'gemini_test',
  description: `Execute or generate tests using Gemini's large context.
Use when:
- Running large test suites
- Generating tests for multiple files
- Analyzing test coverage gaps
- Creating integration test scenarios

Returns structured test results with pass/fail details.`,
  inputSchema: {
    type: 'object',
    properties: {
      test_type: {
        type: 'string',
        enum: ['unit', 'integration', 'e2e', 'all'],
        description: 'Type of tests to run or generate',
      },
      scope: {
        type: 'string',
        description: 'Scope of testing (file path, directory, or feature name)',
      },
      coverage_threshold: {
        type: 'number',
        description: 'Minimum coverage percentage required',
        default: 80,
      },
      generate_missing: {
        type: 'boolean',
        description: 'Generate tests for uncovered code',
        default: false,
      },
      model: {
        type: 'string',
        enum: ['flash', 'pro', 'auto'],
        description: "Gemini model tier. 'auto' (default for test) routes to flash.",
      },
      timeout_ms: {
        type: 'number',
        description: 'Override the per-call timeout in milliseconds.',
      },
    },
    required: ['test_type', 'scope'],
  },
};

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms?: number;
  error?: string;
}

interface TestOutput {
  test_type: string;
  scope: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
  results: TestResult[];
  failures: Array<{
    test: string;
    error: string;
    stack?: string;
  }>;
  generated_tests?: Array<{
    path: string;
    content: string;
    description: string;
  }>;
  recommendations: string[];
}

export async function handleTest(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Input validation + model knob added 2026-05-21.
  const testType = assertEnum(args, 'test_type', ['unit', 'integration', 'e2e', 'all'] as const);
  const scope = assertString(args, 'scope');
  const coverageThreshold = assertOptionalNumber(args, 'coverage_threshold', {
    min: 0,
    max: 100,
  });
  const generateMissing = assertOptionalBoolean(args, 'generate_missing') ?? false;
  const model = assertOptionalEnum(args, 'model', ['flash', 'pro', 'auto'] as const);
  const timeoutMs = assertOptionalNumber(args, 'timeout_ms', { min: 1000 });

  const prompt = buildPrompt(
    `Analyze and ${generateMissing ? 'generate tests for' : 'execute tests in'}: ${scope}

Test type: ${testType}
Coverage threshold: ${coverageThreshold ?? 80}%
${generateMissing ? 'Generate missing tests for uncovered code' : 'Report test execution results'}

Analyze the code structure and:
1. Identify all testable units
2. ${generateMissing ? 'Generate comprehensive tests' : 'Run existing tests'}
3. Calculate code coverage
4. Provide recommendations for improving test quality`,
    {},
    `Return a JSON object with this structure:
{
  "test_type": "${testType}",
  "scope": "the scope analyzed",
  "total": number,
  "passed": number,
  "failed": number,
  "skipped": number,
  "coverage": 0-100,
  "results": [
    {
      "name": "test name",
      "status": "pass|fail|skip",
      "duration_ms": number,
      "error": "error message if failed"
    }
  ],
  "failures": [
    {
      "test": "failed test name",
      "error": "error description",
      "stack": "stack trace"
    }
  ],
  ${
    generateMissing
      ? `"generated_tests": [
    {
      "path": "path/to/new.test.ts",
      "content": "test file content",
      "description": "what this test covers"
    }
  ],`
      : ''
  }
  "recommendations": ["suggestions for improving tests"]
}`
  );

  const result = await executeGemini(prompt, {
    tool: 'gemini_test',
    input: args,
    files: [`@${scope}`],
    timeout_ms: timeoutMs ?? 300000,
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

  const parsed = parseGeminiJson<TestOutput>(result.output);

  if (!parsed) {
    return {
      success: true,
      raw_output: result.output,
      warning: 'Could not parse structured output - returning raw',
      session_id: result.session_id,
    };
  }

  // Validate test output
  const validation = validateTestOutput(parsed as unknown as Record<string, unknown>);

  // Check coverage threshold
  const meetsCoverage = parsed.coverage ? parsed.coverage >= (coverageThreshold ?? 80) : null;

  return {
    success: true,
    ...parsed,
    meets_coverage_threshold: meetsCoverage,
    validation,
    session_id: result.session_id,
  };
}
