# Supabase 正式后台部署

## 1. 先备份

在项目目录运行：

```powershell
pnpm backup:legacy
```

确认 `local-backups` 中存在包含分类和资料的 JSON。该目录不会提交到 GitHub。

## 2. 建立正式数据表

在 Supabase 的 `SQL Editor` 新建查询，执行：

`supabase/migrations/20260719010000_professional_backend.sql`

迁移会创建真实账号权限、分类、内容、媒体、附件、标签、版本记录、操作日志和 Storage 策略，并把 `348933516@qq.com` 设置为初始超级管理员。

## 3. 关闭公开注册

打开 `Authentication -> Sign In / Providers -> Email`，关闭允许访客自行注册。后台新增账号统一通过“邀请管理员”。

## 4. 部署 Edge Functions

需要部署：

- `invite-admin`
- `update-admin`
- `import-url`
- `publish-content`
- `restore-revision`
- `save-content`

可以在 GitHub 仓库 Secrets 中设置 `SUPABASE_ACCESS_TOKEN` 和 `SUPABASE_DB_PASSWORD`，然后手动运行 `Deploy Supabase backend` 工作流。

## 5. 迁移旧数据

PowerShell 中设置临时环境变量后执行：

```powershell
$env:SUPABASE_ADMIN_EMAIL="348933516@qq.com"
$env:SUPABASE_ADMIN_PASSWORD="你的登录密码"
pnpm migrate:legacy
Remove-Item Env:SUPABASE_ADMIN_PASSWORD
```

脚本会迁移分类、首页设置、正文和媒体；Data URL 图片会上传到 Storage。密码不会写入文件。

## 6. 验证后切换

先访问 `/preview/`。确认匿名用户看不到草稿、上传管理员不能发布、内容管理员不能管理账号、图片视频刷新后仍存在，再切换根站。切换完成后再执行 `supabase/manual/freeze-legacy-after-cutover.sql`，旧表仅超级管理员可读并保留 30 天用于回滚。
