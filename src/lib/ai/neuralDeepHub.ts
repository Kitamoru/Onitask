/**
 * Neural Deep Hub (NDH) client — F-04 chat completion for task parsing.
 *
 * Model: qwen3.6-35b-a3b-noreason
 * Endpoint: https://api.neuraldeep.ru/v1/chat/completions
 * Auth: NEURALDEEP_KEY env variable
 *
 * Based on: onitask_ai_.md §3.4 (Parse with JSON mode)
 * Security: onitask_security_.md §1.1 (JSON mode mandatory)
 * A-6: single model call, no fallback chain
 */

export interface ChatOptions {
  /** System/user prompt content */
  prompt: string;
  /** Temperature (default 0.1 for deterministic parse) */
  temperature?: number;
  /** Max tokens (default 800 for parse response) */
  max_tokens?: number;
}

export async function chatCompletion(options: ChatOptions): Promise<string> {
  const apiKey = process.env.NEURALDEEP_KEY;
  if (!apiKey) {
    throw new Error('NEURALDEEP_KEY is not set');
  }

  try {
    const res = await fetch('https://api.neuraldeep.ru/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen3.6-35b-a3b-noreason',
        messages: [
          { role: 'system', content: 'Respond ONLY with valid JSON. No markdown, no explanations, no code fences.' },
          { role: 'user', content: options.prompt },
        ],
        response_format: { type: 'json_object' }, // mandatory (LLM-1, security §1.1)
        temperature: options.temperature ?? 0.1,
        max_tokens: options.max_tokens ?? 800,
      }),
    });

    console.log('[ndh] HTTP status:', res.status);

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Neural Deep Hub error ${res.status}: ${errBody}`);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '';
    console.log('[ndh] Raw response length:', content.length);
    return content;
  } catch (err) {
    console.error('[ndh] chatCompletion failed:', err);
    throw err;
  }
}