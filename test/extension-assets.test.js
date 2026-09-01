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
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'cookies', 'storage', 'tabs']);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, manifest.background.service_worker)), true);
  assert.equal(fs.existsSync(path.join(pluginRoot, manifest.action.default_popup)), true);
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

test('popup exposes an explicit imported-data cleanup action', () => {
  const popupHtml = fs.readFileSync(path.join(pluginRoot, 'popup/popup.html'), 'utf8');
  const popupScript = fs.readFileSync(path.join(pluginRoot, 'popup/popup.js'), 'utf8');
  assert.match(popupHtml, /id="clear-accounts"[^>]*>清除导入数据<\/button>/);
  assert.match(popupScript, /不会清除 ChatGPT Cookie/);
  assert.match(popupScript, /tabId: tab\.id/);
});

test('popup footer shows the release version and author credit', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
  const popupHtml = fs.readFileSync(path.join(pluginRoot, 'popup/popup.html'), 'utf8');

  assert.equal(manifest.version, '1.0.0');
  assert.equal(packageJson.version, manifest.version);
  assert.match(popupHtml, /v1\.0\.0 · Built by MaixXx/);
});
