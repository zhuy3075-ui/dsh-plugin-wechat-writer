/**
 * 四个工具：自检、质量闸门、风格推荐、成稿导出。
 *
 * 都是对随包 Python 脚本的薄封装，价值在三点：
 *   1) 路径由插件解析（数据目录/脚本目录），模型不用猜；
 *   2) 把脚本的行文本输出解析成结构化结论；
 *   3) 临时文件、编码、解释器探测这些容易翻车的细节收在插件里。
 *
 * 不做的事：配图（要第三方 API Key）与推草稿箱（要公众号凭证、且不可撤销）。
 * 那两件事交给技能正文里的说明和用户自己的凭证，插件不替用户保管密钥。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineTextTool, clamp } from './tool-kit.js'
import { runPython, describeFailure } from './python.js'
import { SKILL_NAME } from './workspace.js'

const GATE_METRIC_ROWS = [
  ['originality_score', '原创度'],
  ['ai_tone_score', 'AI 味'],
  ['humanity_score', '人味'],
  ['ngram_overlap', 'n-gram 重合'],
  ['sentence_reuse_ratio', '整句复用率'],
  ['structure_similarity', '结构相似度'],
  ['novelty_ratio', '新句占比'],
  ['template_sentence_ratio', '模板句占比'],
  ['source_trace_hits', '来源痕迹命中'],
  ['ai_filler_hits', 'AI 套话命中'],
  ['scene_density', '场景密度'],
  ['colloquial_ratio', '口语化比例'],
  ['sentence_cv', '句长变异系数'],
  ['paragraph_cv', '段长变异系数'],
  ['lexical_diversity', '用词多样性'],
  ['short_paragraph_ratio', '短段占比'],
  ['dash_density', '破折号密度'],
  ['domain_label', '场景判定'],
  ['ai_risk_level', 'AI 风险等级'],
]

function formatNumber(value) {
  if (typeof value !== 'number') return String(value)
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/** 解析脚本的 `key: value` 输出。 */
export function parseKeyValue(stdout) {
  const metrics = {}
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([a-z][a-z0-9_]*)\s*:\s*(.*)$/.exec(line.trim())
    if (match === null) continue
    const raw = match[2].trim()
    if (/^-?\d+$/.test(raw)) metrics[match[1]] = Number.parseInt(raw, 10)
    else if (/^-?\d+\.\d+$/.test(raw)) metrics[match[1]] = Number.parseFloat(raw)
    else if (raw === 'True') metrics[match[1]] = true
    else if (raw === 'False') metrics[match[1]] = false
    else metrics[match[1]] = raw
  }
  return metrics
}

async function withTempDir(prefix, work) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  try {
    return await work(dir)
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响结果 */
    }
  }
}

function safeFileStem(value, fallback) {
  const text = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text === '' ? fallback : clamp(text, 40)
}

export function registerTools(ctx, deps) {
  const { cfg, dataDir, seeded, skill } = deps
  const scriptsDir = path.join(dataDir, 'scripts')

  /* ------------------------------------------------------------------ */
  /* 1. 自检                                                             */
  /* ------------------------------------------------------------------ */
  const statusTool = defineTextTool({
    name: 'wechat_writer_status',
    description:
      '公众号写作插件自检：返回技能是否已注册、技能数据目录、随包资源数量、风格库清单、Python 解释器版本。安装后、排查「技能没出现 / 脚本跑不动」时先调它。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const lines = ['## 公众号写作插件自检', '']
      lines.push(`- 插件版本：${seeded.version ?? '未知'}`)
      lines.push(`- 技能名：\`${SKILL_NAME}\``)
      lines.push(`- 技能数据目录：\`${dataDir}\``)
      lines.push(
        `- 本次播种：新建 ${seeded.created} · 升级 ${seeded.updated} · 保留 ${seeded.kept}`,
      )

      const count = (rel, filter = () => true) => {
        try {
          return fs.readdirSync(path.join(dataDir, rel)).filter(filter).length
        } catch {
          return 0
        }
      }
      const styleFiles = (() => {
        try {
          return fs
            .readdirSync(path.join(dataDir, 'styles'))
            .filter((f) => f.endsWith('.md') && !/^readme/i.test(f))
            .map((f) => f.replace(/\.md$/, ''))
        } catch {
          return []
        }
      })()

      lines.push(`- 风格库：${styleFiles.length} 个${styleFiles.length > 0 ? `（${styleFiles.join('、')}）` : ''}`)
      lines.push(`- 文章模板：${count('templates', (f) => f.endsWith('.md'))} 个`)
      lines.push(`- 记忆文件：${count('memory', (f) => f.endsWith('.md'))} 个`)
      lines.push(`- 脚本文件：${count('scripts', (f) => f.endsWith('.py'))} 个`)

      // 技能注册状态：不打印正文，只核对目录里确实能取到
      const skills = ctx.get('skills')
      if (skills === undefined || skills === null) {
        lines.push('- 技能注册：❌ skills 服务未挂载')
      } else if (!skill.registered) {
        lines.push(`- 技能注册：❌ ${skill.reason ?? '未注册'}`)
      } else {
        try {
          const catalog = await skills.list()
          const listed = catalog.some((entry) => entry.name === SKILL_NAME)
          const loaded = listed ? await skills.get(SKILL_NAME) : undefined
          lines.push(
            `- 技能注册：${listed ? '✅ 已出现在技能目录' : '❌ 不在技能目录'}` +
              `${loaded ? `，正文 ${loaded.content.length} 字符` : ''}`,
          )
        } catch (error) {
          lines.push(`- 技能注册：⚠ 查询失败（${error?.message ?? error}）`)
        }
      }

      try {
        const result = await runPython(cfg, path.join(scriptsDir, 'path_manifest.py'), ['--help'], {
          cwd: dataDir,
          timeoutMs: 20_000,
        })
        const versionLine = result.stdout.split(/\r?\n/).find((line) => line.includes('--dir')) ?? ''
        lines.push(`- Python：✅ \`${result.interpreter}\`（脚本可运行${versionLine ? '，参数解析正常' : ''}）`)
      } catch (error) {
        lines.push(`- Python：❌ ${error?.message ?? error}`)
      }

      return { text: lines.join('\n'), data: { dataDir, styles: styleFiles, seeded } }
    },
  })

  /* ------------------------------------------------------------------ */
  /* 2. 质量闸门                                                          */
  /* ------------------------------------------------------------------ */
  const gateTool = defineTextTool({
    name: 'wechat_writer_gate',
    description:
      '对公众号文章跑「原创度 / AI 味 / 人味」三项量化闸门（scripts/originality_quality_gate.py）。写完稿、改完稿准备交付前必须调一次；给出三项分数、是否通过、以及未通过的具体原因。可附带参考素材，用于计算重合度与整句复用。',
    parameters: {
      type: 'object',
      properties: {
        article: { type: 'string', description: '文章全文（Markdown 或纯文本）' },
        articlePath: { type: 'string', description: '也可以给文章文件路径，代替 article' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: '参考素材原文数组，用于计算重合度/复用率（可选）',
        },
        sourcePaths: {
          type: 'array',
          items: { type: 'string' },
          description: '参考素材文件路径数组，代替 sources（可选）',
        },
        minOriginality: { type: 'number', description: '原创度下限，默认 70' },
        maxAiTone: { type: 'number', description: 'AI 味上限，默认 30' },
        minHumanity: { type: 'number', description: '人味下限，默认 60' },
        strictSourceTrace: {
          type: 'boolean',
          description: '出现来源痕迹词时把原创度直接判 0（严格模式）',
        },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const minOriginality = typeof args.minOriginality === 'number' ? args.minOriginality : 70
      const maxAiTone = typeof args.maxAiTone === 'number' ? args.maxAiTone : 30
      const minHumanity = typeof args.minHumanity === 'number' ? args.minHumanity : 60

      const articleText =
        typeof args.article === 'string' && args.article.trim() !== ''
          ? args.article
          : typeof args.articlePath === 'string' && args.articlePath.trim() !== ''
            ? readTextOrThrow(args.articlePath, '文章文件')
            : undefined
      if (articleText === undefined) {
        throw new Error('请提供 article（文章全文）或 articlePath（文章文件路径）')
      }

      const sources = []
      for (const text of args.sources ?? []) {
        if (typeof text === 'string' && text.trim() !== '') sources.push(text)
      }
      for (const file of args.sourcePaths ?? []) {
        if (typeof file === 'string' && file.trim() !== '') {
          sources.push(readTextOrThrow(file, '素材文件'))
        }
      }

      return withTempDir('wechat-gate-', async (dir) => {
        const articleFile = path.join(dir, 'article.md')
        fs.writeFileSync(articleFile, articleText, 'utf8')

        const argv = ['-a', articleFile]
        const sourceFiles = []
        sources.forEach((text, index) => {
          const file = path.join(dir, `source-${index}.md`)
          fs.writeFileSync(file, text, 'utf8')
          sourceFiles.push(file)
        })
        if (sourceFiles.length > 0) argv.push('-s', ...sourceFiles)
        argv.push(
          '--min-originality',
          String(minOriginality),
          '--max-ai-tone',
          String(maxAiTone),
          '--min-humanity',
          String(minHumanity),
        )
        if (args.strictSourceTrace === true) argv.push('--strict-source-trace')

        const result = await runPython(
          cfg,
          path.join(scriptsDir, 'originality_quality_gate.py'),
          argv,
          { cwd: dataDir },
        )
        if (!result.ok) {
          return { text: describeFailure(result, 'originality_quality_gate.py') }
        }

        const metrics = parseKeyValue(result.stdout)
        if (metrics.originality_score === undefined) {
          return {
            text: `脚本已运行但输出里没有分数，原始输出：\n\n\`\`\`text\n${result.stdout.trim()}\n\`\`\``,
          }
        }

        const failures = []
        if (metrics.originality_score < minOriginality) {
          failures.push(`原创度 ${formatNumber(metrics.originality_score)} < 门槛 ${minOriginality}`)
        }
        if (metrics.ai_tone_score > maxAiTone) {
          failures.push(`AI 味 ${formatNumber(metrics.ai_tone_score)} > 门槛 ${maxAiTone}`)
        }
        if (metrics.humanity_score < minHumanity) {
          failures.push(`人味 ${formatNumber(metrics.humanity_score)} < 门槛 ${minHumanity}`)
        }
        if (failures.length === 0 && metrics.passed === false) {
          failures.push(
            `策略闸门未过（模板句占比 ${formatNumber(metrics.template_sentence_ratio ?? 0)} 需 ≤ 0.12、` +
              `句长变异 ${formatNumber(metrics.sentence_cv ?? 0)} 需 ≥ 0.35、` +
              `段长变异 ${formatNumber(metrics.paragraph_cv ?? 0)} 需 ≥ 0.45、` +
              `来源痕迹需为 0，当前 ${formatNumber(metrics.source_trace_hits ?? 0)}）`,
          )
        }

        const passed = metrics.passed === true
        const lines = [
          `## 质检结果：${passed ? '✅ 通过' : '❌ 未通过'}`,
          '',
          '| 指标 | 数值 | 门槛 | 结论 |',
          '| --- | --- | --- | --- |',
          `| 原创度 | ${formatNumber(metrics.originality_score)} | ≥ ${minOriginality} | ${metrics.originality_score >= minOriginality ? '✅' : '❌'} |`,
          `| AI 味 | ${formatNumber(metrics.ai_tone_score)} | ≤ ${maxAiTone} | ${metrics.ai_tone_score <= maxAiTone ? '✅' : '❌'} |`,
          `| 人味 | ${formatNumber(metrics.humanity_score)} | ≥ ${minHumanity} | ${metrics.humanity_score >= minHumanity ? '✅' : '❌'} |`,
          `| AI 风险等级 | ${formatNumber(metrics.ai_risk_level)} | — | — |`,
          `| 场景判定 | ${formatNumber(metrics.domain_label)} | — | — |`,
          '',
        ]
        if (failures.length > 0) {
          lines.push('**未通过原因**', ...failures.map((item) => `- ${item}`), '')
        }
        lines.push('**完整指标**', '', '| 指标 | 数值 |', '| --- | --- |')
        for (const [key, label] of GATE_METRIC_ROWS) {
          if (metrics[key] === undefined) continue
          lines.push(`| ${label}（${key}） | ${formatNumber(metrics[key])} |`)
        }
        lines.push('', `素材数量：${sources.length} 篇`)

        return {
          text: lines.join('\n'),
          data: { metrics, passed, thresholds: { minOriginality, maxAiTone, minHumanity }, failures },
        }
      })
    },
  })

  /* ------------------------------------------------------------------ */
  /* 3. 风格清单与推荐                                                    */
  /* ------------------------------------------------------------------ */
  const stylesTool = defineTextTool({
    name: 'wechat_writer_styles',
    description:
      '列出公众号写作插件里可用的写作风格，或按主题/素材推荐 Top-K 风格（scripts/style_recommender.py）。用户问「有哪些风格」「用哪个风格写」，或写稿前需要选风格时调它。',
    parameters: {
      type: 'object',
      properties: {
        listOnly: { type: 'boolean', description: '只列清单，不做推荐' },
        content: { type: 'string', description: '用于推荐的用户素材/主题描述' },
        contentPath: { type: 'string', description: '素材文件路径，代替 content' },
        articleType: {
          type: 'string',
          description: '文章类型：干货 / 观点 / 故事 / 清单 / 热点',
        },
        topK: { type: 'number', description: '推荐数量，默认 3' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const listOnly = args.listOnly === true
      const topK = typeof args.topK === 'number' && args.topK > 0 ? Math.floor(args.topK) : 3

      let content = typeof args.content === 'string' ? args.content : ''
      if (content === '' && typeof args.contentPath === 'string' && args.contentPath.trim() !== '') {
        content = readTextOrThrow(args.contentPath, '素材文件')
      }
      // content 与 articleType 都没给也能跑：脚本会退化成「只列清单 + 基础匹配」

      const argv = ['--styles-dir', path.join(dataDir, 'styles')]
      if (listOnly) argv.push('--list-only')
      if (typeof args.articleType === 'string' && args.articleType.trim() !== '') {
        argv.push('--article-type', args.articleType.trim())
      }
      argv.push('--top-k', String(topK))

      if (content.length > 600) {
        return withTempDir('wechat-styles-', async (dir) => {
          const file = path.join(dir, 'content.md')
          fs.writeFileSync(file, content, 'utf8')
          return finish(await runPython(cfg, path.join(scriptsDir, 'style_recommender.py'), [...argv, '--content-file', file], { cwd: dataDir }))
        })
      }
      if (content.trim() !== '') argv.push('--content', content)
      return finish(await runPython(cfg, path.join(scriptsDir, 'style_recommender.py'), argv, { cwd: dataDir }))

      function finish(result) {
        if (!result.ok) {
          return { text: describeFailure(result, 'style_recommender.py') }
        }
        return { text: `\`\`\`text\n${result.stdout.trim()}\n\`\`\`` }
      }
    },
  })

  /* ------------------------------------------------------------------ */
  /* 4. 成稿导出                                                          */
  /* ------------------------------------------------------------------ */
  const formatTool = defineTextTool({
    name: 'wechat_writer_format',
    description:
      '把定稿按公众号规范导出：md（原样归档）、json（标题/摘要/标签/分节结构 + 质检分数）、wechat（可直接粘进公众号编辑器的纯文本）。文件落在技能数据目录的 outputs/ 下，并返回真实路径。',
    parameters: {
      type: 'object',
      properties: {
        article: { type: 'string', description: '文章全文（Markdown）' },
        articlePath: { type: 'string', description: '也可以给文章文件路径，代替 article' },
        mode: {
          type: 'string',
          enum: ['md', 'json', 'both', 'wechat'],
          description: '导出格式，默认 both（md+json）',
        },
        style: { type: 'string', description: '使用的风格名（用于归档目录与 json 记录）' },
        articleType: { type: 'string', description: '文章类型：干货/观点/故事/清单/热点' },
        topic: { type: 'string', description: '主题关键词（用于归档目录名）' },
        originality: { type: 'number', description: '质检原创度分数（可选，写进 json）' },
        aiTone: { type: 'number', description: '质检 AI 味分数（可选）' },
        humanity: { type: 'number', description: '质检人味分数（可选）' },
        outputDir: { type: 'string', description: '自定义输出目录（可选，默认 outputs/ 下按风格分类）' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const articleText =
        typeof args.article === 'string' && args.article.trim() !== ''
          ? args.article
          : typeof args.articlePath === 'string' && args.articlePath.trim() !== ''
            ? readTextOrThrow(args.articlePath, '文章文件')
            : undefined
      if (articleText === undefined) {
        throw new Error('请提供 article（文章全文）或 articlePath（文章文件路径）')
      }

      const mode = typeof args.mode === 'string' ? args.mode : 'both'
      const styleName =
        typeof args.style === 'string' && args.style.trim() !== ''
          ? safeFileStem(args.style, '默认风格')
          : '默认风格'
      // 与 SKILL.md「落地文件规范」一致：outputs/{风格名}/{日期}-{类型}-{主题}/
      const outDir =
        typeof args.outputDir === 'string' && args.outputDir.trim() !== ''
          ? path.resolve(args.outputDir.trim())
          : uniqueDir(
              path.join(
                dataDir,
                'outputs',
                styleName,
                [
                  dateStamp(),
                  safeFileStem(args.articleType, '文章'),
                  safeFileStem(args.topic, '未命名'),
                ].join('-'),
              ),
            )

      return withTempDir('wechat-format-', async (dir) => {
        const input = path.join(dir, 'article.md')
        fs.writeFileSync(input, articleText, 'utf8')

        const argv = ['-i', input, '-o', outDir, '--mode', mode]
        if (typeof args.style === 'string' && args.style.trim() !== '') argv.push('--style', args.style.trim())
        if (typeof args.articleType === 'string' && args.articleType.trim() !== '') {
          argv.push('--article-type', args.articleType.trim())
        }
        if (typeof args.originality === 'number') argv.push('--originality', String(args.originality))
        if (typeof args.aiTone === 'number') argv.push('--ai-tone', String(args.aiTone))
        if (typeof args.humanity === 'number') argv.push('--humanity', String(args.humanity))

        const result = await runPython(
          cfg,
          path.join(scriptsDir, 'article_output_formatter.py'),
          argv,
          { cwd: dataDir },
        )
        if (!result.ok) {
          return { text: describeFailure(result, 'article_output_formatter.py') }
        }

        const written = result.stdout
          .split(/\r?\n/)
          .filter((line) => line.startsWith('wrote: '))
          .map((line) => line.slice('wrote: '.length).trim())

        let payload
        const jsonPath = written.find((file) => file.endsWith('.json'))
        if (jsonPath !== undefined && fs.existsSync(jsonPath)) {
          try {
            payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
          } catch {
            /* 元信息只是锦上添花，读不出来不影响导出结果 */
          }
        }

        // SKILL.md 要求每个产出目录都带 README.md（自检/风险/质量/配图/金句/素材）。
        // 工具只保证骨架和它真的知道的数字，细节留给创作流程补写；已有 README 不覆盖。
        const readmePath = writeReadmeIfMissing(outDir, {
          title: payload?.title,
          summary: payload?.summary,
          articleType: typeof args.articleType === 'string' ? args.articleType.trim() : '',
          style: typeof args.style === 'string' ? args.style.trim() : '',
          topic: typeof args.topic === 'string' ? args.topic.trim() : '',
          chars: countChars(articleText),
          mode,
          files: written.map((file) => path.basename(file)),
          scores: {
            originality: typeof args.originality === 'number' ? args.originality : undefined,
            aiTone: typeof args.aiTone === 'number' ? args.aiTone : undefined,
            humanity: typeof args.humanity === 'number' ? args.humanity : undefined,
          },
        })

        const lines = [`## 已导出（mode=${mode}）`, '']
        if (written.length === 0) {
          lines.push(result.stdout.trim())
        } else {
          for (const file of written) lines.push(`- \`${file}\``)
        }
        if (readmePath !== undefined) {
          lines.push(`- \`${readmePath}\`（说明文档骨架；自检/风险/金句/素材由创作流程补写）`)
        }

        if (payload !== undefined) {
          lines.push(
            '',
            '**稿件元信息**',
            '',
            `- 标题：${payload.title ?? '（未识别）'}`,
            `- 摘要：${clamp(payload.summary ?? '', 80) || '（未识别）'}`,
            `- 标签：${Array.isArray(payload.tags) && payload.tags.length > 0 ? payload.tags.join('、') : '（未识别）'}`,
            `- 分节：${Array.isArray(payload.sections) ? payload.sections.length : 0} 个`,
          )
        }
        lines.push('', `输出目录：\`${outDir}\``)

        return { text: lines.join('\n'), data: { mode, outDir, written, readme: readmePath } }
      })
    },
  })

  const tools = [statusTool, gateTool, stylesTool, formatTool]
  const disposers = []
  const failed = []
  for (const tool of tools) {
    try {
      const dispose = ctx.tools.register(tool)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      failed.push(`${tool.name}: ${error?.message ?? error}`)
    }
  }

  return { count: disposers.length, failed, dispose: () => disposers.forEach((fn) => fn()) }
}

function readTextOrThrow(file, label) {
  const resolved = path.resolve(file)
  try {
    return fs.readFileSync(resolved, 'utf8')
  } catch (error) {
    throw new Error(`读不到${label}：${resolved}（${error?.message ?? error}）`)
  }
}

function dateStamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 同一天同类型同主题写第二篇时不要互相覆盖：追加 -2、-3。 */
function uniqueDir(baseDir) {
  if (!fs.existsSync(baseDir)) return baseDir
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${baseDir}-${index}`
    if (!fs.existsSync(candidate)) return candidate
  }
  return `${baseDir}-${Date.now()}`
}

/** 粗略统计正文字数：去掉 Markdown 标记后按字符数算，够写在说明文档里。 */
function countChars(markdown) {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`~>|-]/g, '')
    .replace(/\s/g, '').length
}

/**
 * 写产出目录的说明文档骨架（已存在则不覆盖，避免盖掉创作流程写的详细版）。
 */
function writeReadmeIfMissing(outDir, info) {
  const file = path.join(outDir, 'README.md')
  if (fs.existsSync(file)) return undefined

  const score = (value) => (typeof value === 'number' ? String(value) : '—')
  const lines = [
    `# ${info.title ?? info.topic ?? '文章产出'}`,
    '',
    '## 基本信息',
    '',
    `- 类型：${info.articleType || '—'}`,
    `- 风格：${info.style || '默认风格'}`,
    `- 日期：${dateStamp()}`,
    `- 字数：约 ${info.chars} 字`,
    `- 导出模式：${info.mode}`,
    `- 文件：${info.files.length > 0 ? info.files.join('、') : '—'}`,
    '',
    '## 自检报告',
    '',
    '> 由创作流程（SKILL.md 第七步）填写：结构/节奏/开头/结尾/排版自检结果。',
    '',
    '## 风险核查报告',
    '',
    '> 由创作流程（SKILL.md 第六步）填写：风险等级、命中项、修改建议。',
    '',
    '## 质量分数',
    '',
    '| 指标 | 分数 | 门槛 |',
    '| --- | --- | --- |',
    `| 原创度 | ${score(info.scores.originality)} | ≥ 70 |`,
    `| AI 味 | ${score(info.scores.aiTone)} | ≤ 30 |`,
    `| 人味 | ${score(info.scores.humanity)} | ≥ 60 |`,
    '',
    '## 配图信息',
    '',
    '> 无配图时保留此表并写「暂无」；有配图时补文件名、位置、提示词、风格、状态。',
    '',
    '| 文件 | 位置 | 提示词 | 风格 | 状态 |',
    '| --- | --- | --- | --- | --- |',
    '| — | — | — | — | 暂无 |',
    '',
    '## 金句摘录',
    '',
    '> 由创作流程填写本文使用的金句。',
    '',
    '## 引用素材',
    '',
    '> 由创作流程填写引用的素材 ID 与来源。',
    '',
  ]

  try {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(file, lines.join('\n'), 'utf8')
    return file
  } catch {
    return undefined
  }
}

