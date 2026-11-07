/**
 * 调用技能自带 Python 脚本的唯一入口。
 *
 * 两个必须处理的 Windows 细节：
 *   1) 中文输出：强制 PYTHONUTF8 / PYTHONIOENCODING，避免 cp936 与 Node 的 utf8 对不上；
 *   2) 解释器名不一定叫 python：按 python → py → python3 依次探测，只在「找不到可执行文件」
 *      时换下一个，脚本自身报错不重试（否则同一个错误会跑三遍）。
 */
import { execFile } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** 已确认可用的解释器，避免每个工具调用都重复探测。 */
let resolvedInterpreter

function candidates(cfg) {
  if (resolvedInterpreter !== undefined) return [resolvedInterpreter]
  if (cfg?.pythonPath) return [cfg.pythonPath]
  return ['python', 'py', 'python3']
}

function runOnce(exe, args, options) {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          // 不让用户机器上的 .pyc 缓存污染随包脚本
          PYTHONDONTWRITEBYTECODE: '1',
        },
      },
      (error, stdout, stderr) => {
        if (error !== null && (error.code === 'ENOENT' || error.code === 'EACCES')) {
          reject(error)
          return
        }
        resolve({
          ok: error === null,
          exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          timedOut: error !== null && error.killed === true,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        })
      },
    )
  })
}

/**
 * 运行一个脚本文件。
 *
 * @param {{pythonPath?: string}} cfg 插件配置
 * @param {string} script 绝对路径的 .py
 * @param {string[]} args 脚本参数
 * @param {{cwd?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, exitCode: number, timedOut: boolean, stdout: string, stderr: string, interpreter: string}>}
 */
export async function runPython(cfg, script, args, options = {}) {
  const list = candidates(cfg)
  const tried = []
  for (let index = 0; index < list.length; index += 1) {
    const exe = list[index]
    try {
      const result = await runOnce(exe, [script, ...args], options)
      if (cfg?.pythonPath === undefined || cfg.pythonPath === '') resolvedInterpreter = exe
      return { ...result, interpreter: exe }
    } catch (error) {
      tried.push(`${exe}（${error?.code ?? error?.message ?? 'unknown'}）`)
    }
  }
  throw new Error(
    `找不到可用的 Python 解释器，已尝试：${tried.join('、')}。请在插件配置里设置 pythonPath。`,
  )
}

/** 把一次脚本执行的结果压成模型可读的失败说明。 */
export function describeFailure(result, script) {
  const parts = [`脚本执行失败：${script}`]
  if (result.timedOut) parts.push('（超时）')
  else parts.push(`（退出码 ${result.exitCode}）`)
  if (result.stderr.trim() !== '') parts.push('', '```text', result.stderr.trim().slice(-2000), '```')
  if (result.stdout.trim() !== '') parts.push('', '```text', result.stdout.trim().slice(-2000), '```')
  return parts.join('\n')
}
