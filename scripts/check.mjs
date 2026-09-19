// The page's inline script is never parsed until a browser loads it, so a
// syntax error ships silently and the app renders as a blank shell. Parse it here.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const html = readFileSync('public/index.html', 'utf8');
const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
if (!script) { console.error('no inline script found'); process.exit(1); }

const tmp = '.script-check.mjs';
writeFileSync(tmp, script);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
  console.log('ok — inline script parses');
} finally {
  unlinkSync(tmp);
}
