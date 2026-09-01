const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');

function readPngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', filePath);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('manifest references existing least-privilege extension resources', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'cookies', 'sidePanel', 'storage', 'tabs']);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, manifest.background.service_worker)), true);
  assert.equal(Object.hasOwn(manifest.action, 'default_popup'), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, manifest.side_panel.default_path)), true);
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  for (const [size, file] of Object.entries(manifest.icons)) {
    const iconPath = path.join(pluginRoot, file);
    assert.equal(fs.existsSync(iconPath), true, file);
    assert.deepEqual(readPngDimensions(iconPath), {
      width: Number(size),
      height: Number(size),
    });
  }
  for (const contentScript of manifest.content_scripts) {
    for (const file of contentScript.js) {
      assert.equal(fs.existsSync(path.join(pluginRoot, file)), true, file);
    }
  }
});

test('side panel exposes account cleanup, progress and step logs', () => {
  const backgroundScript = fs.readFileSync(path.join(pluginRoot, 'background.js'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(pluginRoot, 'sidepanel/sidepanel.html'), 'utf8');
  const panelScript = fs.readFileSync(path.join(pluginRoot, 'sidepanel/sidepanel.js'), 'utf8');
  assert.match(backgroundScript, /openPanelOnActionClick:\s*true/);
  assert.match(panelHtml, /id="clear-accounts"[^>]*>清除导入数据<\/button>/);
  assert.match(panelHtml, /id="steps-section"/);
  assert.match(panelHtml, /id="log-list"[^>]*role="log"/);
  assert.match(panelHtml, /id="clear-logs"[^>]*>清空<\/button>/);
  assert.match(panelScript, /不会清除 ChatGPT Cookie/);
  assert.match(panelScript, /tabId: tab\.id/);
  assert.doesNotMatch(panelScript, /window\.close\(/);
});

test('side panel footer shows the release version and author credit', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
  const panelHtml = fs.readFileSync(path.join(pluginRoot, 'sidepanel/sidepanel.html'), 'utf8');

  assert.equal(manifest.version, '1.1.0');
  assert.equal(packageJson.version, manifest.version);
  assert.match(panelHtml, /v1\.1\.0 · Built by MaixXx/);
});
