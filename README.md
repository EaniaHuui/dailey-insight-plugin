# Obsidian 每日回顾

Obsidian 每日回顾是一个 Obsidian 社区插件，用于从本地笔记中抽取回顾内容，预提交未来几天的回顾库存到服务端，再由服务端按计划推送到 RSS 或 Cubox。

## 功能

- 打开 Obsidian 时自动补齐未来 1-30 天的回顾队列
- 支持每天 1-20 条回顾
- 支持排除文件夹、最短字数过滤和 90 天去重
- 支持 RSS 私有订阅
- 支持 Cubox API 推送
- 支持匿名初始化和手动输入 Token，适合多设备共用

## 配置

插件只需要两项核心信息：

- `服务器地址`
- `访问 Token`

首次安装时，如果已经配置了服务器地址但没有 Token，插件会自动调用服务端匿名初始化接口创建身份。你也可以把另一台设备上的 Token 粘贴过来，复用同一用户。

## 开发

```bash
npm install
npx tsc --noEmit -p tsconfig.json
node esbuild.config.mjs
```

构建产物：

- `main.js`
- `manifest.json`
- `styles.css`

## 发布到 Obsidian 社区市场

1. 更新 `manifest.json` 中的版本号
2. 更新 `versions.json`
3. 重新构建 `main.js`
4. 创建同版本 GitHub Release
5. 在 Release 附件中上传：
   - `main.js`
   - `manifest.json`
   - `styles.css`
6. 向 `obsidianmd/obsidian-releases` 提交社区插件 PR

## 作者

Eania
