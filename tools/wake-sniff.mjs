#!/usr/bin/env node
// tools/wake-sniff.mjs
// Dev-only smoke: subscribe to a public Realtime channel 'agent:<agent_key_id>'
// and print any 'work.available' broadcast. Verifies the wake publisher
// (migration 071 ops_publisher_tick) end-to-end.
//
// Usage:
//   node tools/wake-sniff.mjs <agent_key_id> [timeoutSeconds]
//
// Env:
//   SUPABASE_URL       — https://<project>.supabase.co
//   SUPABASE_ANON_KEY  — publishable / legacy anon key (client-side only)

import { createClient } from '@supabase/supabase-js';

const keyId = process.argv[2];
const timeoutSec = Number(process.argv[3] ?? 120);

if (!keyId) {
  console.error('usage: node tools/wake-sniff.mjs <agent_key_id> [timeoutSeconds]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('ENV: SUPABASE_URL and SUPABASE_ANON_KEY are required.');
  process.exit(2);
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const channelName = `agent:${keyId}`;
const got = [];

console.log(
  `[wake-sniff] subscribing to "${channelName}" for ${timeoutSec}s (public channel, anon key)`
);

const channel = supabase
  .channel(channelName, { config: { private: false } })
  .on('broadcast', { event: 'work.available' }, (payload) => {
    got.push(new Date().toISOString());
    console.log('[wake-sniff] BROADCAST work.available received:');
    console.log(JSON.stringify(payload, null, 2));
  })
  .subscribe((status) => {
    console.log(`[wake-sniff] subscribe status: ${status}`);
    if (status === 'CHANNEL_ERROR') {
      console.error('[wake-sniff] channel error — check Realtime enabled / anon key');
    }
  });

const timer = setTimeout(async () => {
  console.log(
    `[wake-sniff] timeout (${timeoutSec}s) — received ${got.length} broadcast(s)`
  );
  await supabase.removeChannel(channel);
  process.exit(0);
}, timeoutSec * 1000);

// Graceful close on SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  clearTimeout(timer);
  console.error('[wake-sniff] interrupted');
  await supabase.removeChannel(channel);
  process.exit(130);
});