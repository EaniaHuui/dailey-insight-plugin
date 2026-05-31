# Obsidian 每日回顾

Obsidian 每日回顾是一个 Obsidian 社区插件。它会在你打开 Obsidian 时，从本地笔记中抽取回顾内容，补齐未来 1-30 天的库存，并把这些库存提交到服务端，再由服务端按天输出到 RSS 或推送到 Cubox。

## 主要功能

- 打开 Obsidian 时自动补齐未来 `1-30` 天库存
- 支持每天 `1-20` 条回顾
- 支持排除文件夹、最短字数过滤、90 天去重
- 支持 RSS 私有订阅
- 支持 Cubox API 推送
- 支持匿名初始化与手动输入 Token，多设备可共用同一用户
- 内置“今日回顾”阅读器与侧边栏入口

## 使用方式

首次安装时只需要两项核心信息：

- `服务器地址`
- `访问 Token`

如果已经配置了服务器地址但还没有 Token，插件会自动调用 `POST /api/v1/auth/anonymous` 创建匿名身份，并把返回的 Token 保存在本地。另一台设备可以直接粘贴同一个 Token，共用同一用户设置、RSS 地址和库存队列。

### 阅读器入口

- 左侧功能区图标：`Obsidian 每日回顾`
- 命令面板：
  - `打开今日回顾`
  - `打开回顾侧边栏`
  - `立即补齐回顾队列`

### 今日回顾动作

- `标记已读`
- `稍后再看`
- `加入再回顾`
- `打开原笔记`

### 当前产品边界

- 同步模式固定为 `local`
- 摘要功能已移除
- 详情页由服务端直接输出完整 HTML 正文

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

## 发布到 Obsidian 社区市场

1. 更新 `manifest.json` 版本号
2. 更新 `versions.json`
3. 重新执行 `npm run build`
4. 创建同版本 GitHub Release
5. 在 Release 附件中上传 `main.js`、`manifest.json`、`styles.css`
6. 向 `obsidianmd/obsidian-releases` 提交社区插件 PR

## 作者

Eania
