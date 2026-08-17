import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  OUTPUT_DIR,
  SIZES,
  createActivityBarSvg,
  pngFileName,
  readBrandSource,
  sha256
} from './brand-assets.mjs';

/**
 * 品牌派生图标自动化一致性与质量校验
 * 
 * 校验目标与设计决策：
 * 1. 验证 manifest.json 的存在性、版本及源文件 SHA-256 签名，确保派生文件未处于过期状态；
 * 2. 逐一验证各尺寸 PNG 实际内容与清单中哈希的一致性；
 * 3. 动态重新渲染对比，验证现有 PNG 确实由当前 SVG 渲染产出；
 * 4. 几何与透明度测试：
 *    - 验证图像宽高完全匹配指定尺寸；
 *    - 验证 hasAlpha 为 true，确保圆角透明度保留；
 *    - 验证左上角像素透明度（Alpha=0），防止被填充为不透明黑底；
 *    - 验证中心区域像素不透明度（Alpha>250），确保主体清晰呈现；
 * 5. 验证 Activity Bar 矢量图标包含 fill="currentColor" 且尺寸为 24x24。
 */
async function verifyIcons() {
  const source = await readBrandSource();
  const sourceHash = sha256(source);
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read generated manifest. Run npm run icons:generate first. (${error.message})`);
  }

  // 校验 Manifest 基础结构与源文件指纹
  assert.equal(manifest.schemaVersion, 1, 'Unexpected asset manifest schema version.');
  assert.equal(manifest.source, '../wanlaiide.svg', 'Unexpected asset source path.');
  assert.equal(manifest.sourceSha256, sourceHash, 'Generated assets are stale; regenerate them from the brand SVG.');
  assert.equal(manifest.files.length, SIZES.length + 1, 'Generated asset list is incomplete.');

  // 逐一校验每个尺寸的 PNG 图像
  for (const size of SIZES) {
    const fileName = pngFileName(size);
    const expected = manifest.files.find((entry) => entry.file === fileName);
    assert.ok(expected, `Manifest is missing ${fileName}.`);
    assert.equal(expected.size, size, `Manifest size is wrong for ${fileName}.`);

    const actual = await readFile(path.join(OUTPUT_DIR, fileName));
    assert.equal(sha256(actual), expected.sha256, `${fileName} does not match its manifest hash.`);

    // 重新渲染比对，确认完全由当前 SVG 源文件产出
    const rendered = await sharp(Buffer.from(source))
      .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    assert.equal(sha256(actual), sha256(rendered), `${fileName} was not generated from the current brand SVG.`);

    // 检查元数据与 Alpha 通道
    const image = sharp(actual);
    const metadata = await image.metadata();
    assert.equal(metadata.width, size, `${fileName} width is incorrect.`);
    assert.equal(metadata.height, size, `${fileName} height is incorrect.`);
    assert.equal(metadata.hasAlpha, true, `${fileName} must preserve transparent rounded corners.`);

    // 提取原始像素检验圆角透明性（左上角透明，中心不透明）
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, `${fileName} must be transparent in its top-left corner.`);
    const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    assert.ok(data[center + 3] > 250, `${fileName} center must remain opaque.`);
  }

  // 校验 Activity Bar 矢量图标
  const activityBarFile = 'wanlaiide-activitybar.svg';
  const activityBar = await readFile(path.join(OUTPUT_DIR, activityBarFile), 'utf8');
  const expectedActivityBar = createActivityBarSvg(source, sourceHash);
  assert.equal(activityBar, expectedActivityBar, 'Activity Bar icon is stale or manually edited.');
  assert.match(activityBar, /fill="currentColor"/, 'Activity Bar icon must adapt to light and dark themes.');
  assert.match(activityBar, /width="24" height="24"/, 'Activity Bar icon must have a 24px viewport.');

  const activityBarManifest = manifest.files.find((entry) => entry.file === activityBarFile);
  assert.ok(activityBarManifest, 'Manifest is missing the Activity Bar icon.');
  assert.equal(activityBarManifest.sha256, sha256(activityBar), 'Activity Bar icon does not match its manifest hash.');

  console.log(`Validated ${SIZES.length} PNG icons and the adaptive Activity Bar icon.`);
}

await verifyIcons();
