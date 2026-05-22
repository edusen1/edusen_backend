/**
 * Patch whatsapp-web.js Client.js — wraps `await this.inject()` inside the
 * `framenavigated` handler in a try/catch so that "Execution context was
 * destroyed" errors during page navigation no longer crash the process.
 *
 * Applied in Dockerfile after `npm ci`, idempotent (safe to run multiple times).
 */
const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');

if (!fs.existsSync(clientPath)) {
  console.log('[patch-wweb] Client.js not found — skipping');
  process.exit(0);
}

const original = `            await this.inject();
        });`;

const patched = `            try {
                await this.inject();
            } catch (_) {
                // Execution context may be destroyed during navigation — safe to ignore
            }
        });`;

let content = fs.readFileSync(clientPath, 'utf8');

if (content.includes(patched)) {
  console.log('[patch-wweb] Already patched — skipping');
  process.exit(0);
}

if (!content.includes(original)) {
  console.log('[patch-wweb] Target not found — whatsapp-web.js version may have changed');
  process.exit(0);
}

content = content.replace(original, patched);
fs.writeFileSync(clientPath, content, 'utf8');
console.log('[patch-wweb] ✅ Client.js patched successfully');
