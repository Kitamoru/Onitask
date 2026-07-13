// API key validation + timingSafeEqual (A-2)
// Validates MCP client API keys using constant-time comparison to prevent timing attacks

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function validateMcpApiKey(headerKey: string, expectedKey: string): Promise<boolean> {
  // TODO: Load expected key from environment/secret store
  const expected = expectedKey || process.env.MCP_API_KEY || '';
  return timingSafeEqual(headerKey, expected);
}