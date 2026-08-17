import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 项目根目录绝对路径
 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 品牌 SVG 唯一源文件路径
 */
export const SOURCE_PATH = path.join(ROOT, 'assets', 'brand', 'wanlaiide.svg');

/**
 * 生成派生图标资源的输出目录
 */
export const OUTPUT_DIR = path.join(ROOT, 'assets', 'brand', 'generated');

/**
 * 需生成的 PNG 图标尺寸列表（覆盖 VS Code 扩展市场、活动栏、菜单及高分屏）
 */
export const SIZES = [16, 24, 32, 48, 128, 256];

/**
 * 计算给定内容的 SHA-256 哈希值
 * 
 * @param {string | Buffer} content - 需要计算哈希的文本或二进制缓冲区
 * @returns {string} 64 位十六进制 SHA-256 字符串
 */
export const sha256 = (content) => createHash('sha256').update(content).digest('hex');

/**
 * 读取并校验品牌 SVG 源文件
 * 
 * @description 读取 assets/brand/wanlaiide.svg 并执行严格校验，保证源文件未被破坏或篡改
 * @returns {Promise<string>} 校验通过的 SVG 源码文本
 * @throws {Error} 当文件缺失关键几何结构或含有未经确认的颜色时抛出异常
 */
export async function readBrandSource() {
  const source = await readFile(SOURCE_PATH, 'utf8');
  validateBrandSource(source);
  return source;
}

/**
 * 校验品牌源文件内容是否符合规范
 * 
 * 校验逻辑与实现原因：
 * 1. 确保画布为标准 1024x1024 视口与黑色背景（#1E1E1E），保持各平台呈现的一致性；
 * 2. 检查银灰色线性渐变 stop 色值，确保品牌主体色彩未发生偏差；
 * 3. 严格拦截金色色值（如 #D4AF37、#FFD700 等），防止旧版本金色 Logo 被误用或重新引入。
 * 
 * @param {string} source - SVG 源码文本
 * @throws {Error} 当缺少关键结构或包含非法颜色时抛出错误
 */
export function validateBrandSource(source) {
  const requiredFragments = [
    'viewBox="0 0 1024 1024"',
    '<rect width="1024" height="1024" rx="220" fill="#1E1E1E"/>',
    '<linearGradient id="silver"',
    'stop-color="#FFFFFF"',
    'stop-color="#E9ECEF"',
    'stop-color="#A9B0B8"'
  ];

  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) {
      throw new Error(`Brand source is missing required fragment: ${fragment}`);
    }
  }

  // 拦截金色色值，杜绝错误的历史品牌变体混入
  if (/#(?:[A-Fa-f0-9]{2})?(?:D4AF37|FFD700|C9A227)\b/i.test(source)) {
    throw new Error('Brand source must not contain a gold logo color.');
  }
}

/**
 * 从品牌 SVG 源码中提取核心标志并生成自适应主题的 Activity Bar 图标
 * 
 * 实现原因与设计决策：
 * VS Code Activity Bar 需要跟随编辑器主题（深色/浅色/高对比度）动态变色。
 * 因此提取银色渐变主体的几何路径，并将填充色设定为 fill="currentColor"，
 * 同时将视口固定为 VS Code 推荐的 24x24，使图标在侧边栏能够自动适配主题前景色。
 * 
 * @param {string} source - 品牌源 SVG 文本
 * @param {string} sourceHash - 源文件的 SHA-256 哈希，写入注释以便版本溯源
 * @returns {string} 生成的 Activity Bar 专用 SVG 文本
 * @throws {Error} 当无法在源文件中匹配到核心银色图形标记时抛出错误
 */
export function createActivityBarSvg(source, sourceHash) {
  const match = source.match(/<g fill="url\(#silver\)">([\s\S]*?)<\/g>/);
  if (!match) {
    throw new Error('Could not extract the silver mark from the brand source.');
  }

  return [
    '<svg width="24" height="24" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">',
    `  <!-- Generated from ../wanlaiide.svg (sha256: ${sourceHash}). Do not edit. -->`,
    '  <g fill="currentColor">',
    match[1].trim(),
    '  </g>',
    '</svg>',
    ''
  ].join('\n');
}

/**
 * 获取指定尺寸的 PNG 图标文件名
 * 
 * @param {number} size - 图标边长像素值（如 16, 24, 32 等）
 * @returns {string} 格式化后的文件名（如 wanlaiide-16.png）
 */
export function pngFileName(size) {
  return `wanlaiide-${size}.png`;
}
