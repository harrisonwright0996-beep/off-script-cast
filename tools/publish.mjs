// Publishes the app to Cloudflare Pages: only what a phone needs, never the tests, tools or worker.
// Usage: node tools/publish.mjs (after npx wrangler login)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILES = ['index.html', 'staff.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icons', 'src', 'vendor'];
const out = mkdtempSync(join(tmpdir(), 'off-script-cast-'));
try {
  for (const f of FILES) cpSync(f, join(out, f), { recursive: true });
  execFileSync('npx', ['wrangler', 'pages', 'deploy', out, '--project-name', 'off-script-cast', '--branch', 'main', '--commit-dirty=true', '--force'], { stdio: 'inherit' });
} finally {
  rmSync(out, { recursive: true });
}
