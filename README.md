# 公众号写作插件（dsh-plugin-wechat-writer）

把压缩包里的「公众号写作」技能做成了一个可安装、可升级、可分发的 Harness 插件的形态：

- **技能**：`wechat-writer`（技能目录里能搜到，模型用 `skill` 工具加载）
- **工具**：4 个 `wechat_writer_*` 工具，把随包 Python 脚本包成结构化接口

一次安装，写稿全流程（解析意图 → 唤醒人格 → 大纲 → 正文 → 质检 → 排版导出）都在。

---

## 1. 安装

在 Harness 里让模型执行：

```
plugin_manager  install_bundle  target = <本目录绝对路径>
```

装完检查两件事：

1. 技能目录里出现 `wechat-writer`（模型会在下一轮拿到刷新后的技能清单）；
2. 工具列表里出现 `wechat_writer_status` —— 直接调它做自检。

## 2. 它在磁盘上放了什么

插件安装目录只放**只读资源**（`skill/` 是随包发布的原始技能）。
运行时状态放在**技能数据目录**，默认：

| 平台 | 默认路径 |
| --- | --- |
| Windows | `C:\Users\<你>\.dsh\wechat-writer` |
| macOS / Linux | `~/.dsh/wechat-writer` |

首次激活时，插件把 `skill/` 整体播种进去；之后：

- `memory/`、`styles/`、`learning/`、`outputs/` 由使用过程持续写入（这才是「会成长」的部分）；
- 升级插件时，**没被你改过**的文件随包更新，**你改过的**文件原样保留（靠 `.seed-manifest.json` 区分）；
- 想彻底回到出厂状态：删掉该目录，重启 Harness，重新播种。

## 3. 配置

`cordis.patch.yml` 的 config 段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | 空 → `$DSH_HOME/wechat-writer` | 技能数据目录，可放任意可写路径 |
| `pythonPath` | 空 → 自动探测 `python` / `py` / `python3` | 脚本解释器 |
| `seed` | `true` | 关掉后只读现有目录，不再随插件升级同步资源 |

## 4. 工具

| 工具 | 干什么 | 什么时候调 |
| --- | --- | --- |
| `wechat_writer_status` | 自检：目录、播种结果、风格数、Python、技能注册状态 | 装完、排查问题 |
| `wechat_writer_gate` | 原创度 / AI 味 / 人味三项量化闸门，返回分数、通过与否、未通过原因 | 写完稿、改完稿、交付前 |
| `wechat_writer_styles` | 列风格清单，或按主题/素材推荐 Top-K | 选风格、写稿前 |
| `wechat_writer_format` | 导出 md / json / 微信纯文本到 `outputs/{风格}/{日期}-{类型}-{主题}/`，并补齐 `README.md` 骨架（自检/风险/质量/配图/金句/素材六个小节） | 定稿后 |

对应脚本：`scripts/originality_quality_gate.py`、`scripts/style_recommender.py`、`scripts/article_output_formatter.py`。

**没有包成工具的两件事**（都涉及用户自己的凭证，插件不代管）：

- 配图生成 → `scripts/generate_images.py`（云雾 API Key，填 `config/image-gen.local.yaml`）
- 推公众号草稿箱 → `scripts/publish_wechat.py`（AppID/AppSecret，填 `config/wechat.local.yaml`）

技能正文里有这两个流程的完整说明，让模型按 `SKILL.md` 的步骤走即可。

## 5. 目录结构

```
dsh-plugin-wechat-writer/
├── package.json          # 含 dsh.bundle.patch，安装入口
├── cordis.patch.yml      # 插件行 + 默认配置
├── lib/
│   ├── index.js          # apply：播种 → 注册技能 → 注册工具
│   ├── workspace.js      # 数据目录解析 + 三方合并播种
│   ├── skill.js          # 读 SKILL.md 并注册成 wechat-writer
│   ├── tools.js          # 4 个工具
│   ├── python.js         # 解释器探测 / UTF-8 / 超时
│   └── tool-kit.js       # 工具样板
├── skill/                # 随包技能资源（原始「公众号写作」目录）
├── locale/{zh,en}.json   # 插件面板标题与描述
├── icon.svg              # 插件图标
└── README.md
```

## 6. 排错

| 现象 | 先看什么 |
| --- | --- |
| 技能目录里没有 `wechat-writer` | 调 `wechat_writer_status` 看「技能注册」一行；`skills 服务未挂载` 说明宿主没装 `@deepseek-ai/dsh-skill` |
| 工具报「找不到可用的 Python 解释器」 | 在 config 里显式写 `pythonPath`（`where python` 的绝对路径） |
| 工具报脚本退出码非 0 | 结果里会附上 stderr 末尾；也可以直接在数据目录跑同一条命令复现 |
| 改了 `SKILL.md` 没生效 | 技能正文在注册时读入，重启 Harness 后生效；工具每次调用都读磁盘，不需要重启 |
| 升级后自己的记忆被覆盖 | 不会：`memory/` 下你改过的文件会保留；只有未改动的随包文件才更新 |

## 7. 许可与来源

技能内容来自用户提供的 `公众号写作__4bd99c67da.zip`（原始目录 `~/.codex/skills/wechatskill`）。
插件外壳代码为本仓库新增，MIT。
