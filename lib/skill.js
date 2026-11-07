/**
 * 把技能数据目录里的 SKILL.md 注册成 DSH 技能。
 *
 * 为什么从磁盘读、而不是把 60KB 正文硬编码进 JS：
 * 技能目录才是唯一事实源，用户改 SKILL.md（或升级包）后重启即生效，
 * 也避免把大段中文塞进代码里。
 */
import fs from 'node:fs'
import path from 'node:path'
import { SKILL_NAME } from './workspace.js'

/** 极简 frontmatter 解析：只认单行 `key: value`，足够覆盖 SKILL.md 的头部。 */
export function parseFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { meta: {}, body: text }

  const end = text.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: text }

  const header = text.slice(3, end)
  const bodyStart = text.indexOf('\n', end + 4)
  const body = bodyStart === -1 ? '' : text.slice(bodyStart + 1)
  const meta = {}

  for (const line of header.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (value !== '') meta[match[1]] = value
  }

  return { meta, body }
}

/** 模型加载技能时看到的运行环境说明，把「相对路径」钉到真实目录上。 */
function runtimeNote(dataDir) {
  return [
    '## 运行环境（由 DSH 插件 wechat-writer 提供）',
    '',
    `- 技能数据目录（资源基目录）：\`${dataDir}\``,
    '- 本文件提到的相对路径（`core/`、`rules/`、`prompts/`、`templates/`、`styles/`、`memory/`、`scripts/`、`outputs/` 等）一律相对于该目录解析。',
    '- `memory/`、`styles/`、`learning/`、`outputs/` 是持久状态目录，直接写在这里；不要写到当前会话工作目录，除非用户明确要求。',
    '- 三个配套工具直接可用，不要自己拼 python 命令：',
    '  - `wechat_writer_status`：自检（目录、风格数、Python、技能是否已注册）',
    '  - `wechat_writer_gate`：原创度 / AI 味 / 人味三项量化闸门',
    '  - `wechat_writer_styles`：风格清单与 Top-K 推荐',
    '  - `wechat_writer_format`：成稿导出（md / json / 微信纯文本）',
    '- 配图与推草稿箱需要用户自己的凭证，见 `config/` 与 `scripts/generate_images.py`、`scripts/publish_wechat.py`。',
  ].join('\n')
}

/**
 * 注册技能。返回是否成功以及原因，便于 status 工具与日志核对。
 *
 * @returns {{registered: boolean, reason?: string, dispose?: () => void, file?: string}}
 */
export function registerSkill(ctx, { dataDir }) {
  const skills = ctx.get('skills')
  if (skills === undefined || skills === null) {
    return { registered: false, reason: 'skills 服务未挂载，技能注册被跳过' }
  }

  const file = path.join(dataDir, 'SKILL.md')
  if (!fs.existsSync(file)) {
    return { registered: false, reason: `找不到技能正文：${file}` }
  }

  const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'))
  const description =
    meta.description ??
    '微信公众号文章写作助手：撰写、优化、学习范文风格，自带排版规范、风险检测与记忆进化机制。'

  const dispose = skills.register({
    name: SKILL_NAME,
    description,
    whenToUse:
      meta.whenToUse ??
      '用户要写/改公众号文章、学范文风格、做选题或排版、做发布前风险检查时使用。',
    source: 'custom',
    path: file,
    resourceBase: { kind: 'directory', path: dataDir },
    content: `${runtimeNote(dataDir)}\n\n${body.trimStart()}`,
  })

  return { registered: true, dispose, file, description }
}
