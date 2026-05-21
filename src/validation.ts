/**
 * Validation helpers for Gemini MCP Wrapper.
 *
 * Two layers:
 *   1. **Input validation** (``InputError`` + ``assert*`` helpers, added
 *      2026-05-21 per IMPROVEMENT_NOTES item B). Used by every tool
 *      handler to reject malformed callers cleanly instead of crashing
 *      on ``.map()`` over undefined.
 *   2. **Output validation** (``validate*`` functions, original). Claude
 *      uses these to validate Gemini's response before accepting it.
 *      Lightweight: trusts content quality, checks structure.
 */

import type { ValidationResult } from './types.js';

// =============================================================================
// Input validation (added 2026-05-21)
// =============================================================================

/**
 * Raised when a caller sends a tool input that fails type / presence
 * validation. Caught by ``src/index.ts``'s request handler and surfaced
 * as a clean MCP error response instead of a raw stack trace.
 *
 * Carries the offending field name + the expected shape so the caller
 * (typically another LLM) can self-correct on the next attempt.
 */
export class InputError extends Error {
  readonly field: string;
  readonly expected: string;
  readonly got: string;

  constructor(field: string, expected: string, got: unknown) {
    const gotDescription =
      got === undefined
        ? 'undefined'
        : got === null
          ? 'null'
          : typeof got === 'object'
            ? `${Array.isArray(got) ? 'array' : 'object'}(${JSON.stringify(got).slice(0, 80)})`
            : `${typeof got}(${JSON.stringify(got).slice(0, 80)})`;
    super(`invalid input: '${field}' must be ${expected}; got ${gotDescription}`);
    this.name = 'InputError';
    this.field = field;
    this.expected = expected;
    this.got = gotDescription;
  }
}

/**
 * Assert ``args[name]`` is a non-empty string and return it.
 * Raises ``InputError`` on failure. Used for required string fields.
 */
export function assertString(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new InputError(name, 'non-empty string', v);
  }
  return v;
}

/**
 * Assert ``args[name]`` is a string when present. Returns undefined if absent.
 * Empty strings ARE allowed for optional fields (callers may explicitly
 * pass ``""`` to clear a default).
 */
export function assertOptionalString(
  args: Record<string, unknown>,
  name: string
): string | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new InputError(name, 'string (when present)', v);
  }
  return v;
}

/**
 * Assert ``args[name]`` is an array of strings (each non-empty), and
 * optionally enforce a minimum length. Required field — missing or
 * non-array raises.
 */
export function assertStringArray(
  args: Record<string, unknown>,
  name: string,
  opts: { minLen?: number } = {}
): string[] {
  const v = args[name];
  if (!Array.isArray(v)) {
    throw new InputError(name, 'string array', v);
  }
  if (!v.every((x) => typeof x === 'string' && x.length > 0)) {
    throw new InputError(name, 'array of non-empty strings', v);
  }
  if (opts.minLen !== undefined && v.length < opts.minLen) {
    throw new InputError(name, `string array with at least ${opts.minLen} item(s)`, v);
  }
  return v;
}

/**
 * Optional string-array variant. Returns undefined if absent.
 */
export function assertOptionalStringArray(
  args: Record<string, unknown>,
  name: string
): string[] | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new InputError(name, 'string array (when present)', v);
  }
  return v;
}

/**
 * Assert ``args[name]`` is a finite number; optional ``min`` / ``max`` bounds.
 */
export function assertNumber(
  args: Record<string, unknown>,
  name: string,
  opts: { min?: number; max?: number } = {}
): number {
  const v = args[name];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new InputError(name, 'finite number', v);
  }
  if (opts.min !== undefined && v < opts.min) {
    throw new InputError(name, `number >= ${opts.min}`, v);
  }
  if (opts.max !== undefined && v > opts.max) {
    throw new InputError(name, `number <= ${opts.max}`, v);
  }
  return v;
}

/**
 * Optional number variant.
 */
export function assertOptionalNumber(
  args: Record<string, unknown>,
  name: string,
  opts: { min?: number; max?: number } = {}
): number | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  return assertNumber(args, name, opts);
}

/**
 * Optional boolean variant. Returns undefined if absent.
 */
export function assertOptionalBoolean(
  args: Record<string, unknown>,
  name: string
): boolean | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') {
    throw new InputError(name, 'boolean (when present)', v);
  }
  return v;
}

/**
 * Assert ``args[name]`` is one of the allowed enum values (when present).
 * Returns undefined if absent. Use for required enums by checking the
 * return value at the call site.
 */
export function assertOptionalEnum<T extends string>(
  args: Record<string, unknown>,
  name: string,
  allowed: readonly T[]
): T | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new InputError(name, `one of [${allowed.join('|')}]`, v);
  }
  return v as T;
}

/**
 * Required enum variant — same as ``assertOptionalEnum`` but raises when absent.
 */
export function assertEnum<T extends string>(
  args: Record<string, unknown>,
  name: string,
  allowed: readonly T[]
): T {
  const v = assertOptionalEnum(args, name, allowed);
  if (v === undefined) {
    throw new InputError(name, `one of [${allowed.join('|')}] (required)`, undefined);
  }
  return v;
}

/**
 * Assert ``args[name]`` is an array of objects; each item passes ``perItem``.
 * Throws on missing, non-array, or invalid item.
 */
export function assertObjectArray<T>(
  args: Record<string, unknown>,
  name: string,
  perItem: (item: unknown, index: number) => T,
  opts: { minLen?: number } = {}
): T[] {
  const v = args[name];
  if (!Array.isArray(v)) {
    throw new InputError(name, 'object array', v);
  }
  if (opts.minLen !== undefined && v.length < opts.minLen) {
    throw new InputError(name, `object array with at least ${opts.minLen} item(s)`, v);
  }
  return v.map((item, i) => perItem(item, i));
}

/**
 * Assert ``args[name]`` is a plain object (when present). Returns undefined if absent.
 */
export function assertOptionalRecord(
  args: Record<string, unknown>,
  name: string
): Record<string, unknown> | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new InputError(name, 'object (when present)', v);
  }
  return v as Record<string, unknown>;
}

// =============================================================================
// Output validation (original)
// =============================================================================

/**
 * Validate that output matches expected scope
 */
export function validateScope(
  output: Record<string, unknown>,
  expectedKeys: string[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of expectedKeys) {
    if (!(key in output)) {
      errors.push(`Missing expected key: ${key}`);
    }
  }

  // Check for unexpected keys (warning only)
  const outputKeys = Object.keys(output);
  for (const key of outputKeys) {
    if (!expectedKeys.includes(key) && key !== 'metadata') {
      warnings.push(`Unexpected key in output: ${key}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate that all requested files exist in output
 */
export function validateFileList(
  output: Record<string, unknown>,
  requestedPaths: string[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const files = output.files as Array<{ path: string }> | undefined;

  if (!Array.isArray(files)) {
    errors.push('Output missing files array');
    return { valid: false, errors, warnings };
  }

  const outputPaths = new Set(files.map((f) => f.path));

  for (const path of requestedPaths) {
    if (!outputPaths.has(path)) {
      warnings.push(`Requested file not in output: ${path}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate generated code has proper syntax markers
 */
export function validateCodeBlocks(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for balanced code blocks
  const codeBlockStarts = (content.match(/```\w*/g) || []).length;
  const codeBlockEnds = (content.match(/```\s*$/gm) || []).length;

  if (codeBlockStarts !== codeBlockEnds) {
    errors.push(`Unbalanced code blocks: ${codeBlockStarts} starts, ${codeBlockEnds} ends`);
  }

  // Check for common syntax issues
  if (content.includes('// TODO: implement') && !content.includes('// Implementation')) {
    warnings.push('Contains placeholder TODOs without implementation');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate research results have sources
 */
export function validateResearchOutput(output: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!output.findings || !Array.isArray(output.findings)) {
    errors.push('Research output missing findings array');
  }

  if (!output.sources || !Array.isArray(output.sources)) {
    warnings.push('Research output missing sources - cannot verify claims');
  }

  const findings = output.findings as Array<{ content: string }> | undefined;
  const sources = output.sources as string[] | undefined;

  if (findings && sources) {
    if (findings.length > 0 && sources.length === 0) {
      warnings.push('Findings present but no sources cited');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate test results
 */
export function validateTestOutput(output: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof output.passed !== 'number' && typeof output.failed !== 'number') {
    errors.push('Test output missing pass/fail counts');
  }

  if (output.failed && (output.failed as number) > 0) {
    if (!output.failures || !Array.isArray(output.failures)) {
      warnings.push('Failed tests reported but no failure details provided');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate documentation completeness
 */
export function validateDocumentOutput(
  output: Record<string, unknown>,
  requiredSections: string[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const content = output.content as string | undefined;

  if (!content) {
    errors.push('Document output missing content');
    return { valid: false, errors, warnings };
  }

  for (const section of requiredSections) {
    // Check for section headers (# or ##)
    const sectionPattern = new RegExp(`^#+\\s*${section}`, 'im');
    if (!sectionPattern.test(content)) {
      warnings.push(`Missing section: ${section}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate analysis output
 */
export function validateAnalysisOutput(output: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!output.summary) {
    errors.push('Analysis output missing summary');
  }

  if (!output.recommendations && !output.findings) {
    warnings.push('Analysis lacks actionable recommendations or findings');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Combine multiple validation results
 */
export function combineValidations(...results: ValidationResult[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const result of results) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
