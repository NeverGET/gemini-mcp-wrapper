/**
 * Per-tool input-rejection tests. Each handler is invoked with malformed
 * input and we assert that an ``InputError`` rejects the promise BEFORE
 * any ``gemini`` subprocess is spawned. This is the structural test for
 * IMPROVEMENT_NOTES item B (the unguarded ``.map()`` crash) plus its
 * class — all 8 tools now validate inputs eagerly.
 *
 * We never test the success path here — that would require mocking
 * ``executeGemini`` (which spawns the real CLI). Success-path coverage
 * lands as a live smoke test after each install + restart.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { handleDialogue } from '../tools/dialogue.js';
import { handleResearch } from '../tools/research.js';
import { handleGenerate } from '../tools/generate.js';
import { handleFileScan } from '../tools/file-scan.js';
import { handleAnalyze } from '../tools/analyze.js';
import { handleTest } from '../tools/test.js';
import { handleDocument } from '../tools/document.js';
import { handleContinue } from '../tools/continue.js';

const expectsInputError = (err: Error) => err.name === 'InputError';

describe('handleDialogue input validation', () => {
  it('rejects missing topic', async () => {
    await assert.rejects(handleDialogue({ context: 'x', questions: ['q1'] }), expectsInputError);
  });

  it('rejects missing context', async () => {
    await assert.rejects(handleDialogue({ topic: 'x', questions: ['q1'] }), expectsInputError);
  });

  it('rejects missing questions — the canonical Bug B repro', async () => {
    await assert.rejects(handleDialogue({ topic: 'x', context: 'y' }), expectsInputError);
  });

  it('rejects questions not an array', async () => {
    await assert.rejects(
      handleDialogue({ topic: 'x', context: 'y', questions: 'q1' }),
      expectsInputError
    );
  });

  it('rejects empty questions array', async () => {
    await assert.rejects(
      handleDialogue({ topic: 'x', context: 'y', questions: [] }),
      expectsInputError
    );
  });

  it('rejects unknown model value', async () => {
    await assert.rejects(
      handleDialogue({ topic: 'x', context: 'y', questions: ['q'], model: 'turbo' }),
      expectsInputError
    );
  });
});

describe('handleResearch input validation', () => {
  it('rejects missing query', async () => {
    await assert.rejects(handleResearch({}), expectsInputError);
  });

  it('rejects unknown depth value', async () => {
    await assert.rejects(handleResearch({ query: 'x', depth: 'super-deep' }), expectsInputError);
  });

  it('rejects sources of wrong type', async () => {
    await assert.rejects(
      handleResearch({ query: 'x', sources: 'not-an-array' }),
      expectsInputError
    );
  });
});

describe('handleGenerate input validation', () => {
  it('rejects missing spec', async () => {
    await assert.rejects(
      handleGenerate({ files: [{ path: 'a.ts', description: 'A' }] }),
      expectsInputError
    );
  });

  it('rejects missing files — closes Bug B variant', async () => {
    await assert.rejects(handleGenerate({ spec: 'x' }), expectsInputError);
  });

  it('rejects empty files array', async () => {
    await assert.rejects(handleGenerate({ spec: 'x', files: [] }), expectsInputError);
  });

  it('rejects files item missing path', async () => {
    await assert.rejects(
      handleGenerate({ spec: 'x', files: [{ description: 'no path' }] }),
      expectsInputError
    );
  });

  it('rejects files item missing description', async () => {
    await assert.rejects(
      handleGenerate({ spec: 'x', files: [{ path: 'a.ts' }] }),
      expectsInputError
    );
  });
});

describe('handleFileScan input validation', () => {
  it('rejects missing path', async () => {
    await assert.rejects(handleFileScan({}), expectsInputError);
  });

  it('rejects pattern of wrong type', async () => {
    await assert.rejects(handleFileScan({ path: 'src/', pattern: 42 }), expectsInputError);
  });

  it('rejects max_files below 1', async () => {
    await assert.rejects(handleFileScan({ path: 'src/', max_files: 0 }), expectsInputError);
  });

  it('rejects recursive of wrong type', async () => {
    await assert.rejects(handleFileScan({ path: 'src/', recursive: 'yes' }), expectsInputError);
  });
});

describe('handleAnalyze input validation', () => {
  it('rejects missing path', async () => {
    await assert.rejects(handleAnalyze({}), expectsInputError);
  });

  it('rejects unknown focus', async () => {
    await assert.rejects(handleAnalyze({ path: 'src/', focus: 'aesthetics' }), expectsInputError);
  });
});

describe('handleTest input validation', () => {
  it('rejects missing test_type', async () => {
    await assert.rejects(handleTest({ scope: 'src/' }), expectsInputError);
  });

  it('rejects missing scope', async () => {
    await assert.rejects(handleTest({ test_type: 'unit' }), expectsInputError);
  });

  it('rejects unknown test_type', async () => {
    await assert.rejects(handleTest({ test_type: 'fuzz', scope: 'src/' }), expectsInputError);
  });

  it('rejects coverage_threshold out of range', async () => {
    await assert.rejects(
      handleTest({ test_type: 'unit', scope: 'src/', coverage_threshold: 150 }),
      expectsInputError
    );
  });
});

describe('handleDocument input validation', () => {
  it('rejects missing scope', async () => {
    await assert.rejects(handleDocument({ format: 'markdown' }), expectsInputError);
  });

  it('rejects missing format', async () => {
    await assert.rejects(handleDocument({ scope: 'src/' }), expectsInputError);
  });

  it('rejects unknown format', async () => {
    await assert.rejects(handleDocument({ scope: 'src/', format: 'xml' }), expectsInputError);
  });
});

describe('handleContinue input validation', () => {
  it('rejects missing session_id', async () => {
    await assert.rejects(handleContinue({}), expectsInputError);
  });

  it('rejects session_id of wrong type', async () => {
    await assert.rejects(handleContinue({ session_id: 42 }), expectsInputError);
  });
});
