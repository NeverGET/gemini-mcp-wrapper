/**
 * Gemini CLI Executor
 *
 * Wraps the gemini CLI to execute prompts and capture output.
 * Handles session tracking for long-running operations.
 */

import { spawn } from 'child_process';
import type { GeminiResult, ModelChoice } from './types.js';
import { createSession, markComplete, markError, markNeedsContinue } from './session.js';

/**
 * Default timeout in milliseconds (5 minutes)
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Maximum output length before considering truncation
 */
const MAX_OUTPUT_LENGTH = 100000;

// =============================================================================
// Model resolution (added 2026-05-21 per IMPROVEMENT_NOTES item A)
// =============================================================================

/**
 * Concrete Gemini CLI model ids for the ``flash`` / ``pro`` friendly tiers.
 *
 * Verified live 2026-05-21 against CLI v0.38.2 — the ``-preview`` suffix
 * is load-bearing for the Gemini 3 family on the headless ``-m`` flag.
 * The interactive ``/model`` UI lists them as ``gemini-3.1-pro-preview``
 * / ``gemini-3-flash-preview`` and the ``-m`` flag accepts these forms;
 * the bare ``gemini-3.1-pro`` / ``gemini-3-flash`` ids (without
 * ``-preview``) return ``ModelNotFoundError``.
 *
 * Overridable via env vars to fall back to Gemini 2.5 (``gemini-2.5-pro``
 * / ``gemini-2.5-flash``) or roll forward to a future GA id without a
 * code change:
 *   ``export GEMINI_MCP_PRO_MODEL=gemini-2.5-pro``
 *   ``export GEMINI_MCP_FLASH_MODEL=gemini-2.5-flash``
 */
export const FLASH_MODEL = process.env.GEMINI_MCP_FLASH_MODEL ?? 'gemini-3-flash-preview';
export const PRO_MODEL = process.env.GEMINI_MCP_PRO_MODEL ?? 'gemini-3.1-pro-preview';

/**
 * Per-tool ``auto`` defaults — mechanical work routes to flash,
 * reasoning-heavy work routes to pro. ``resolveModel`` escalates any
 * tool's base default to pro if the assembled prompt exceeds 5KB
 * (signal: enough context that depth-of-reasoning materially pays off).
 */
const AUTO_TOOL_DEFAULTS: Readonly<Record<string, 'flash' | 'pro'>> = {
  gemini_research: 'flash',
  gemini_file_scan: 'flash',
  gemini_generate: 'flash',
  gemini_test: 'flash',
  gemini_document: 'flash',
  gemini_dialogue: 'pro',
  gemini_analyze: 'pro',
  gemini_continue: 'flash',
};

const AUTO_PROMPT_BYTES_PRO_THRESHOLD = 5_000;

/**
 * Resolve a friendly model choice + tool context + prompt size to a
 * concrete Gemini CLI model id (passable to ``-m``).
 *
 * Exported for unit testing; also called from ``executeGemini`` below.
 */
export function resolveModel(
  choice: ModelChoice | undefined,
  toolName: string,
  promptBytes: number
): string {
  if (choice === 'flash') return FLASH_MODEL;
  if (choice === 'pro') return PRO_MODEL;
  // 'auto' (or undefined): per-tool default with prompt-size escalation
  const base = AUTO_TOOL_DEFAULTS[toolName] ?? 'flash';
  if (promptBytes > AUTO_PROMPT_BYTES_PRO_THRESHOLD) return PRO_MODEL;
  return base === 'pro' ? PRO_MODEL : FLASH_MODEL;
}

/**
 * Execute a Gemini CLI command
 */
export async function executeGemini(
  prompt: string,
  options: {
    tool: string;
    input: Record<string, unknown>;
    timeout_ms?: number;
    files?: string[];
    all_files?: boolean;
    /**
     * Friendly model choice. Defaults to ``'auto'`` (per-tool heuristic).
     */
    model?: ModelChoice;
  }
): Promise<GeminiResult> {
  const { tool, input, timeout_ms = DEFAULT_TIMEOUT_MS, files, all_files, model } = options;

  // Create session for tracking
  const session = await createSession(tool, input);

  // Resolve the concrete model id. Size measured against the prompt body
  // alone (file attachments add to CLI context but not to this byte count).
  const resolvedModel = resolveModel(model, tool, Buffer.byteLength(prompt, 'utf8'));
  const modelFlags: string[] = ['-m', resolvedModel];

  // Build command arguments
  // Note: Gemini CLI doesn't allow mixing positional args (@files) with -p flag
  // When files are provided, use positional prompt; otherwise use -p flag
  let args: string[];

  if (files && files.length > 0) {
    // Files present: use positional prompt (gemini -m <id> @file1 @file2 "prompt")
    args = [...modelFlags, ...files.map((f) => (f.startsWith('@') ? f : `@${f}`)), prompt];
  } else if (all_files) {
    // all_files flag: use positional prompt (gemini -m <id> --all_files "prompt")
    args = [...modelFlags, '--all_files', prompt];
  } else {
    // No files: use -p flag (gemini -m <id> -p "prompt")
    args = [...modelFlags, '-p', prompt];
  }

  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';
    let timedOut = false;

    const proc = spawn('gemini', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout_ms);

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    proc.on('error', async (error) => {
      clearTimeout(timeoutId);
      await markError(session.id, error.message);
      resolve({
        success: false,
        output: '',
        error: `Failed to execute gemini: ${error.message}`,
        session_id: session.id,
      });
    });

    proc.on('close', async (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        // Check if we have partial output that can be continued
        if (output.length > 0) {
          await markNeedsContinue(session.id, { partial_output: output });
          resolve({
            success: false,
            output,
            error: 'Operation timed out - use gemini_continue to resume',
            needs_continue: true,
            session_id: session.id,
          });
        } else {
          await markError(session.id, 'Operation timed out with no output');
          resolve({
            success: false,
            output: '',
            error: 'Operation timed out',
            session_id: session.id,
          });
        }
        return;
      }

      if (code !== 0) {
        await markError(session.id, errorOutput || `Exit code: ${code}`);
        resolve({
          success: false,
          output,
          error: errorOutput || `Gemini CLI exited with code ${code}`,
          session_id: session.id,
        });
        return;
      }

      // Check for truncation indicators
      if (output.length >= MAX_OUTPUT_LENGTH || output.includes('[Output truncated]')) {
        await markNeedsContinue(session.id, { partial_output: output });
        resolve({
          success: true,
          output,
          needs_continue: true,
          session_id: session.id,
        });
        return;
      }

      await markComplete(session.id, { output });
      resolve({
        success: true,
        output,
        session_id: session.id,
      });
    });
  });
}

/**
 * Parse JSON from Gemini output, handling markdown code blocks
 */
export function parseGeminiJson<T>(output: string): T | null {
  // Try direct parse first
  try {
    return JSON.parse(output) as T;
  } catch {
    // Look for JSON in code blocks
    const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as T;
      } catch {
        // Fall through
      }
    }

    // Look for JSON object/array anywhere
    const objectMatch = output.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as T;
      } catch {
        // Fall through
      }
    }

    const arrayMatch = output.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]) as T;
      } catch {
        // Fall through
      }
    }

    return null;
  }
}

/**
 * Build a structured prompt for Gemini
 */
export function buildPrompt(
  task: string,
  context: Record<string, unknown>,
  outputFormat?: string
): string {
  let prompt = `# Task\n${task}\n\n`;

  if (Object.keys(context).length > 0) {
    prompt += '# Context\n';
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        prompt += `## ${key}\n${value}\n\n`;
      } else {
        prompt += `## ${key}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n`;
      }
    }
  }

  if (outputFormat) {
    prompt += `# Output Format\n${outputFormat}\n`;
  }

  return prompt;
}
