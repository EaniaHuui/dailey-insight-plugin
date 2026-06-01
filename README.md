# Dailey Insight 插件

Dailey Insight 是一个 Obsidian 社区插件。它会在你打开 Obsidian 时，从本地笔记中抽取推荐内容，补齐未来 1-30 天的库存，并把这些库存提交到服务端，再由服务端按天输出到 RSS 或推送到 Cubox。

## 主要功能

- 打开 Obsidian 时自动补齐未来 `1-30` 天库存
- 支持每天 `1-20` 条推荐
- 支持排除文件夹、90 天去重
- 支持 RSS 私有订阅
- 支持 Cubox API 推送
- 支持匿名初始化与手动输入 Token，多设备可共用同一用户
- 内置“今日推荐”阅读器与侧边栏入口
- 支持“一键推送当前笔记”（立即推送，不进入未来队列）

## 使用方式

首次安装时只需要两项核心信息：

- `服务器地址`
- `访问 Token`

如果已经配置了服务器地址但还没有 Token，插件会自动调用 `POST /api/v1/auth/anonymous` 创建匿名身份，并把返回的 Token 保存在本地。另一台设备可以直接粘贴同一个 Token，共用同一用户设置、RSS 地址和库存队列。

插件同时支持“配对码”方式迁移身份。配对码内容包含 `server_url` 和 `token`，适合把一台设备上的身份快速导入到另一台设备。

### 阅读器入口

- 左侧功能区图标：`Dailey Insight`
- 左侧功能区图标：`一键推送当前笔记`（火箭图标，立即推送）
- 命令面板可执行 `打开今日推荐`
- 命令面板可执行 `打开今日推荐侧边栏`
- 命令面板可执行 `立即补齐推荐队列`
- 命令面板可执行 `一键推送当前笔记`（立即推送，不进入队列）
- 命令面板可执行 `测试服务端连接`
- 命令面板可执行 `查看推送历史`
- 命令面板可执行 `退出当前会话`
- 命令面板可执行 `清空 Dailey Insight Token`

### 今日推荐动作

- `标记已读`
- `稍后再看`
- `加入再推荐`
- `打开原笔记`

### 启动行为

- Obsidian 布局加载完成后，插件会执行启动流程
- 若已配置 `serverUrl` 但没有 Token，会先自动匿名初始化
- 然后读取服务端设置、补齐未来库存
- 当天第一次打开且存在推荐内容时，会自动打开侧边栏和“今日推荐”阅读器

### 设置页当前内容

- 服务器地址
- 访问 Token
- RSS 开关、获取地址、复制地址、重置地址
- Cubox 开关、API 地址、收藏夹、标签
- 推送时间、时区
- 预提交天数、每日推送条数
- 排除文件夹
- 读取配置、保存配置、导入配对码、导出配对码、立即同步、退出会话
- 队列覆盖天数、已排队到哪天、最近同步时间、最近错误等状态摘要
- 保存配置成功提示为：`已保存`

### 当前产品边界

- 同步模式固定为 `local`
- 摘要功能已移除
- 详情页由服务端直接输出完整 HTML 正文
- 历史详情弹窗当前显示服务端返回的纯文本正文

### 插件标识

- 社区插件显示名：`Dailey Insight`
- `manifest.json` 插件 ID：`dailey-insight`

## 本地开发

Node 版本使用仓库内 `.nvmrc`。

```bash
npm install
npm run typecheck
npm run build
```

构建产物：

- `main.js`
- `manifest.json`
- `styles.css`

## 调试安装

将以下文件复制到 vault 内的插件目录：

- `main.js`
- `manifest.json`
- `styles.css`

调试目录示例：

- `<vault>/.obsidian/plugins/dailey-insight/`

## 发布到 Obsidian 社区市场

1. 更新 `manifest.json` 版本号
2. 更新 `versions.json`
3. 重新执行 `npm run build`
4. 创建同版本 GitHub Release
5. 在 Release 附件中上传 `main.js`、`manifest.json`、`styles.css`
6. 向 `obsidianmd/obsidian-releases` 提交社区插件 PR

## 作者

Eania
