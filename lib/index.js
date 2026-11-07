/**
 * dsh-plugin-wechat-writer —— 公众号写作插件的宿主入口。
 *
 * 这个插件做三件事，顺序不能换：
 *   1) 播种技能数据目录（SKILL.md、core/、rules/、styles/、memory/、scripts/ …）
 *   2) 把 SKILL.md 注册成名为 wechat-writer 的技能（模型用 `skill` 工具加载）
 *   3) 注册四个工具（自检 / 质检闸门 / 风格推荐 / 成稿导出）
 *
 * 为什么先播种再注册：技能注册时会把 SKILL.md 正文读进内存并指向资源基目录，
 * 文件没落地就注册，模型会拿到一个指向空目录的技能。
 *
 * 纯 JS，零外部依赖；只依赖 dsh 注入的 ctx.tools / ctx.skills / ctx.logger / ctx.effect。
 */
import { resolveConfig, prepareWorkspace } from './workspace.js'
import { registerSkill } from './skill.js'
import { registerTools } from './tools.js'

export const name = 'wechat-writer'

/** 没有 tools 服务就没有这个插件存在的意义；skills 可选（缺了就只提供工具）。 */
export const inject = ['tools']

/**
 * 插件激活入口。
 *
 * @param {object} ctx cordis 上下文
 * @param {object} config cordis.patch.yml 里的 config 段
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config)

  // 所有副作用都在 effect 内，卸载时由返回的清理函数收回。
  ctx.effect(() => {
    const { dataDir, seeded } = prepareWorkspace(cfg)

    let skill
    try {
      skill = registerSkill(ctx, { dataDir })
      if (skill.registered) {
        ctx.logger.info(`wechat-writer: 技能已注册 · 目录 ${dataDir}`)
      } else {
        ctx.logger.warn(`wechat-writer: 技能未注册（${skill.reason}）`)
      }
    } catch (error) {
      skill = { registered: false, reason: error?.message ?? String(error) }
      ctx.logger.error(`wechat-writer: 技能注册失败：${error?.stack ?? error}`)
    }

    const toolset = registerTools(ctx, { cfg, dataDir, seeded, skill })
    ctx.logger.info(
      `wechat-writer: ${toolset.count} 个工具已注册` +
        (toolset.failed.length > 0 ? ` · 失败：${toolset.failed.join('; ')}` : '') +
        ` · 播种 新建 ${seeded.created}/升级 ${seeded.updated}/保留 ${seeded.kept}`,
    )

    return () => {
      toolset.dispose()
      try {
        skill.dispose?.()
      } catch {
        /* 卸载失败不阻断其它清理 */
      }
    }
  }, 'wechat-writer.registration')
}
