const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');

test('manifest references existing least-privilege extension resources', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'cookies', 'storage', 'tabs']);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, manifest.background.service_worker)), true);
  assert.equal(fs.existsSync(path.join(pluginRoot, manifest.action.default_popup)), true);
  for (const contentScript of manifest.content_scripts) {
    for (const file of contentScript.js) {
      assert.equal(fs.existsSync(path.join(pluginRoot, file)), true, file);
    }
  }
});
