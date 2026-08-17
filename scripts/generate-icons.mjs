import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
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
 * 品牌图标自动化生成主流程
 * 
 * 核心逻辑与实现流程：
 * 1. 读取并校验唯一源文件 assets/brand/wanlaiide.svg；
 * 2. 使用临时暂存目录（.staging）进行原子生成，避免生成中断导致目标目录处于不一致状态；
 * 3. 利用 sharp 库以 Lanczos3 滤波算法高质量缩放渲染 16/24/32/48/128/256 尺寸的 PNG；
 * 4. 提取自适应 Activity Bar SVG 图标并计算所有生成文件的 SHA-256；
 * 5. 写入 manifest.json 记录资源清单与源文件指纹；
 * 6. 原子重命名文件至输出目录，清理暂存文件。
 */
async function generateIcons() {
  const source = await readBrandSource();
  const sourceHash = sha256(source);
  const stagingDir = path.join(OUTPUT_DIR, '.staging');

  // 初始化临时暂存目录
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  const files = [];

  // 逐一生成多尺寸 PNG 图标
  for (const size of SIZES) {
    const fileName = pngFileName(size);
    const output = await sharp(Buffer.from(source))
      .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();

    await writeFile(path.join(stagingDir, fileName), output);
    files.push({ file: fileName, size, sha256: sha256(output) });
  }

  // 生成 VS Code Activity Bar 自适应矢量图标
  const activityBarFile = 'wanlaiide-activitybar.svg';
  const activityBarSvg = createActivityBarSvg(source, sourceHash);
  await writeFile(path.join(stagingDir, activityBarFile), activityBarSvg);
  files.push({ file: activityBarFile, role: 'activity-bar', sha256: sha256(activityBarSvg) });

  // 构建并写入资产清单（Manifest）
  const manifest = {
    schemaVersion: 1,
    source: '../wanlaiide.svg',
    sourceSha256: sourceHash,
    files
  };
  await writeFile(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // 原子移动文件到目标生成目录
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const entry of [...files, { file: 'manifest.json' }]) {
    await rename(path.join(stagingDir, entry.file), path.join(OUTPUT_DIR, entry.file));
  }
  await rm(stagingDir, { recursive: true, force: true });

  console.log(`Generated ${files.length} WanLai IDE brand assets from assets/brand/wanlaiide.svg.`);
}

await generateIcons();
