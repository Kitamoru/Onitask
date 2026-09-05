const fs = require('fs');
const p = 'c:/Users/md_li/Onitask/src/components/flowboard/WorkerSheet.tsx';
let c = fs.readFileSync(p, 'utf8');

const startMarker = '  const captionStyle: React.CSSProperties = {';
const endMarker = '// ─── Status:';
const si = c.indexOf(startMarker);
const ei = c.indexOf(endMarker);
if (si === -1 || ei === -1) {
  console.log('markers not found si=' + si + ' ei=' + ei);
  process.exit(1);
}

const lines = [
  '  return (',
  '    <NotchedPanel',
  '      corner="action"',
  '      radius={4}',
  '      notch={8}',
  '      borderWidth={1}',
  '      border="var(--color-line)"',
  '      fill="var(--color-surface)"',
  '      contentClassName="flex flex-col gap-2 p-3"',
  '      aria-label={`${worker.displayName}${worker.roleLabel ? `, ${worker.roleLabel}` : \'\'}`}',
  '    >',
  '      <div className="flex items-start gap-3">',
  '        <div className="flex flex-col items-center gap-1">',
  '          <UserAvatar displayName={worker.displayName} avatarUrl={worker.avatarUrl} />',
  '          <CognitiveWeightIndicator weight={worker.cognitiveWeight} />',
  '        </div>',
  '        <div className="flex min-w-0 flex-1 flex-col gap-1">',
  '          <div className="flex items-center justify-between gap-2">',
  '            <span',
  '              style={{',
  "                fontFamily: 'var(--font-family-display)',",
  "                fontSize: 'var(--text-body-md)',",
  "                lineHeight: 'var(--text-body-md-line)',",
  "                fontWeight: 'var(--font-weight-medium)',",
  "                color: 'var(--color-text-primary)',",
  '              }}',
  '            >',
  '              {worker.displayName}',
  '            </span>',
  '            {worker.overloaded && <PriorityBadge label="Перегружен" color="red" />}',
  '          </div>',
  '          <p',
  '            style={{',
  "              fontFamily: 'var(--font-family-display)',",
  "              fontSize: 'var(--text-body-sm)',",
  "              lineHeight: 'var(--text-body-sm-line)',",
  "              fontWeight: 'var(--font-weight-medium)',",
  "              color: 'var(--color-text-muted)',",
  '            }}',
  '          >',
  "            {worker.type === 'agent' ? 'AI-агент' : 'Пользователь'} · {worker.roleLabel}",
  '          </p>',
  '        </div>',
  '      </div>',
  '    </NotchedPanel>',
  '  );',
  '}',
  '',
];

const newBody = lines.join('\n');
c = c.substring(0, si) + newBody + c.substring(ei);
fs.writeFileSync(p, c, 'utf8');
console.log('Done');