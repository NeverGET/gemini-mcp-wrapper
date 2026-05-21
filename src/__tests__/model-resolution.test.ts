/**
 * Unit tests for resolveModel() in gemini-cli.ts — the model-knob fix from
 * IMPROVEMENT_NOTES item A. Tests cover the four paths: explicit flash,
 * explicit pro, auto with per-tool default, auto with prompt-size escalation.
 *
 * The actual model IDs are read from env vars (GEMINI_MCP_FLASH_MODEL /
 * GEMINI_MCP_PRO_MODEL) with defaults — these tests assert ROUTING
 * BEHAVIOR (which env-driven id is returned), not the literal id strings.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveModel, FLASH_MODEL, PRO_MODEL } from '../gemini-cli.js';

describe('resolveModel', () => {
  describe('explicit choice', () => {
    it('flash returns FLASH_MODEL regardless of tool or size', () => {
      assert.strictEqual(resolveModel('flash', 'gemini_dialogue', 100), FLASH_MODEL);
      assert.strictEqual(resolveModel('flash', 'gemini_analyze', 50_000), FLASH_MODEL);
    });

    it('pro returns PRO_MODEL regardless of tool or size', () => {
      assert.strictEqual(resolveModel('pro', 'gemini_file_scan', 100), PRO_MODEL);
      assert.strictEqual(resolveModel('pro', 'gemini_research', 50_000), PRO_MODEL);
    });
  });

  describe("'auto' with small prompt (< 5KB)", () => {
    it('routes reasoning-heavy tools to pro by default', () => {
      assert.strictEqual(resolveModel('auto', 'gemini_dialogue', 1_000), PRO_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_analyze', 1_000), PRO_MODEL);
    });

    it('routes mechanical tools to flash by default', () => {
      assert.strictEqual(resolveModel('auto', 'gemini_research', 1_000), FLASH_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_file_scan', 1_000), FLASH_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_generate', 1_000), FLASH_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_test', 1_000), FLASH_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_document', 1_000), FLASH_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_continue', 1_000), FLASH_MODEL);
    });

    it('defaults unknown tool names to flash', () => {
      assert.strictEqual(resolveModel('auto', 'unknown_tool', 1_000), FLASH_MODEL);
    });
  });

  describe("'auto' with large prompt (> 5KB) escalates to pro", () => {
    it('escalates a normally-flash tool to pro on >5KB prompts', () => {
      assert.strictEqual(resolveModel('auto', 'gemini_research', 6_000), PRO_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_file_scan', 6_000), PRO_MODEL);
    });

    it("doesn't downgrade a pro-default tool", () => {
      assert.strictEqual(resolveModel('auto', 'gemini_dialogue', 6_000), PRO_MODEL);
    });

    it('respects exact threshold (5000 bytes → flash; 5001 → pro)', () => {
      assert.strictEqual(resolveModel('auto', 'gemini_research', 5_000), FLASH_MODEL);
      assert.strictEqual(resolveModel('auto', 'gemini_research', 5_001), PRO_MODEL);
    });
  });

  describe('undefined choice', () => {
    it('behaves like auto', () => {
      assert.strictEqual(
        resolveModel(undefined, 'gemini_dialogue', 100),
        resolveModel('auto', 'gemini_dialogue', 100)
      );
    });
  });

  describe('default model ids (no env override)', () => {
    it('FLASH_MODEL default is a non-empty gemini-* id', () => {
      assert.match(FLASH_MODEL, /^gemini-/);
    });

    it('PRO_MODEL default is a non-empty gemini-* id', () => {
      assert.match(PRO_MODEL, /^gemini-/);
    });

    it('FLASH_MODEL and PRO_MODEL differ', () => {
      assert.notStrictEqual(FLASH_MODEL, PRO_MODEL);
    });
  });
});
