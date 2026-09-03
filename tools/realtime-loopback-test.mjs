#!/usr/bin/env node
// Diagnostic: client-to-client loopback on a PUBLIC channel.
// Decisive split:
//   - If C1 receives C2's broadcast  -> realtime websocket path WORKS; problem is DB->socket path.
//   - If C1 receives nothing         -> realtime broadcasting is broken for this project/key config.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const topic = 'agent:' + (process.argv[2] || 'diag-client2client');

const c1 = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const c2 = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ch1 = c1.channel(topic, { config: { private: false } });
const ch2 = c2.channel(topic, { config: { private: false } });

let c1got = 0;
ch1.on('broadcast', { event: 'x' }, (p) => {
  c1got++;
  console.log('C1 RECEIVED', JSON.stringify(p));
});
ch2.on('broadcast', { event: 'x' }, (p) => console.log('C2 RECEIVED', JSON.stringify(p)));

await new Promise((r) => ch1.subscribe((s) => { console.log('C1 status:', s); if (s === 'SUBSCRIBED') r(); }));
await new Promise((r) => ch2.subscribe((s) => { console.log('C2 status:', s); if (s === 'SUBSCRIBED') r(); }));

console.log('SENDING from C2 to', topic);
await ch2.send({ type: 'broadcast', event: 'x', payload: { hello: 'world', ts: Date.now() } });

await new Promise((r) => setTimeout(r, 5000));
console.log('C1 received count:', c1got);
process.exit(0);