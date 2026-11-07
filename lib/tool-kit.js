/**
 * tool 工厂：把 dsh 要求的 {name, description, parameters, output:{schema, render}, execute}
 * 样板收在一处，四个 tool 只写业务逻辑，避免各写一遍导致形状不一致。
 */

/** 业务错误：模型能看到 message 并据此调整，不会被当成插件崩溃。 */
export class WriterError extends Error {
  constructor(message, { hint } = {}) {
    super(hint ? `${message}\n\n提示：${hint}` : message)
    this.name = 'WriterError'
  }
}

/**
 * 定义一个只返回文本的 tool。
 *
 * execute 返回 string 或 {text, data?}；出错请抛 WriterError。
 */
export function defineTextTool(spec) {
  const { name, description, parameters, execute } = spec
  if (typeof name !== 'string' || name === '') throw new TypeError('defineTextTool: 缺少 name')
  if (typeof description !== 'string' || description === '') {
    throw new TypeError(`tool "${name}" 缺少 description`)
  }
  if (parameters === null || typeof parameters !== 'object') {
    throw new TypeError(`tool "${name}" 缺少 parameters`)
  }

  return {
    name,
    description,
    parameters,
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          data: {},
        },
        required: ['text'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: value.text ?? '' }]
      },
    },
    async execute(args, exec) {
      const result = await execute(args ?? {}, exec)
      if (typeof result === 'string') return { text: result }
      if (result === null || typeof result !== 'object' || typeof result.text !== 'string') {
        throw new TypeError(`tool "${name}" 的 execute 必须返回 string 或 { text, data? }`)
      }
      return result
    },
  }
}

/** 截断长文本，避免把整篇正文塞回对话。 */
export function clamp(text, max = 160) {
  if (typeof text !== 'string') return ''
  const single = text.trim().replace(/\s+/g, ' ')
  return single.length <= max ? single : `${single.slice(0, max)}…`
}

/** 今天的日期，用于 outputs 子目录命名。 */
export function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
