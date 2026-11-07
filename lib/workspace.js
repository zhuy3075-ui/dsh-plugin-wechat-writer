/**
 * 工作区（技能数据目录）解析与播种。
 *
 * 技能本身是一套「会成长」的文件：memory/ 记学习结果，styles/ 存学到的风格，
 * outputs/ 放成稿。这些必须写在可持久化、可升级、且不会被 npm 覆盖的位置，
 * 所以运行时目录默认落在 <DSH_HOME>/wechat-writer，而不是安装目录。
 *
 * 播种规则（三方合并的简化版）：
 *   - 目标不存在            → 复制
 *   - 目标与上次播种内容一致 → 视为未改过，随包升级覆盖
 *   - 目标被用户改过         → 保留用户内容，永不静默覆盖
 * 清单 .seed-manifest.json 记录「上次播下去的是什么」，靠它区分后两种情况。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

/** 插件包根目录（lib/ 的上一级）。 */
export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 随包发布的技能资源目录。 */
export const BUNDLED_SKILL_DIR = path.join(PACKAGE_DIR, 'skill')

/** 播种清单文件名（位于技能数据目录根部）。 */
export const SEED_MANIFEST = '.seed-manifest.json'

/** 技能被模型调用时使用的名字，必须与 skill/SKILL.md 的调用示例一致。 */
export const SKILL_NAME = 'wechat-writer'

/** 读取包版本，同时用作播种清单的版本标记。 */
export function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 把用户填的路径展开成绝对路径（支持 ~ 与空值）。 */
export function expandPath(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

/** 解析插件配置，补齐默认值。 */
export function resolveConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}

  let dataDir = expandPath(raw.dataDir)
  if (dataDir === undefined) {
    const home = expandPath(process.env.DSH_HOME) ?? path.join(os.homedir(), '.dsh')
    dataDir = path.join(home, 'wechat-writer')
  }

  return {
    dataDir,
    // 留空表示按 python → py → python3 的顺序探测
    pythonPath: expandPath(raw.pythonPath) ?? '',
    // 播种开关：关掉后只读现有目录，不再随包升级同步资源
    seed: raw.seed !== false,
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walk(dir, prefix = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

function readManifest(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, SEED_MANIFEST), 'utf8'))
    if (parsed && typeof parsed.files === 'object' && parsed.files !== null) return parsed
  } catch {
    /* 首次运行或清单损坏都当作空清单：只补缺失文件，不动已有内容。 */
  }
  return { version: null, files: {} }
}

/**
 * 把随包技能资源同步进技能数据目录。
 * 同步执行：apply() 是同步函数，异步写入会让技能注册先于文件落地。
 *
 * @returns {{created: number, updated: number, kept: number, version: string}}
 */
export function syncSkillContent(dataDir) {
  const version = packageVersion()
  const manifest = readManifest(dataDir)
  const next = { version, files: {} }
  const stats = { created: 0, updated: 0, kept: 0, version }

  for (const rel of walk(BUNDLED_SKILL_DIR)) {
    const from = path.join(BUNDLED_SKILL_DIR, ...rel.split('/'))
    const to = path.join(dataDir, ...rel.split('/'))
    const bundledHash = sha256(from)
    next.files[rel] = bundledHash

    const exists = fs.existsSync(to)
    if (!exists) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      stats.created += 1
      continue
    }

    const currentHash = sha256(to)
    if (currentHash === bundledHash) {
      stats.kept += 1
      continue
    }
    const untouched = manifest.files[rel] === currentHash
    if (untouched) {
      fs.copyFileSync(from, to)
      stats.updated += 1
    } else {
      // 用户改过这个文件：保留用户版本，包内新版只在新装或手动清理后生效。
      stats.kept += 1
    }
  }

  fs.writeFileSync(path.join(dataDir, SEED_MANIFEST), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return stats
}

/** 准备技能数据目录：建目录、播种资源、保证 outputs/ 存在。 */
export function prepareWorkspace(cfg, { seed = cfg.seed } = {}) {
  fs.mkdirSync(cfg.dataDir, { recursive: true })
  const seeded = seed ? syncSkillContent(cfg.dataDir) : { created: 0, updated: 0, kept: 0, version: null }
  fs.mkdirSync(path.join(cfg.dataDir, 'outputs'), { recursive: true })
  return { dataDir: cfg.dataDir, seeded }
}
