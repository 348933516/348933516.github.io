# MapleStoryNK Supabase 接入步骤

## 1. 运行建表 SQL

在 Supabase 项目里打开：

`SQL Editor` -> `New query`

复制 `supabase-setup.sql` 里的全部内容，粘贴进去，点击 `Run`。

## 2. 创建后台登录账号

打开：

`Authentication` -> `Users` -> `Add user`

创建一个邮箱账号和密码。之后网站后台用这个邮箱和密码登录。

也可以在网站登录弹窗里点“注册”，填写账号、密码、邮箱。注册完成后，用邮箱登录。

## 3. 网站如何保存云端数据

网站会先读取 Supabase 的 `site_state` 表。

后台用 Supabase 邮箱账号登录后，编辑内容、分类、界面设置时会同步保存到云端。

## 4. 不要暴露这些密钥

可以放到前端的是：

- `Project URL`
- `Publishable key`
- 旧版 `anon public key`

不能放到前端的是：

- `sb_secret_...`
- `service_role`
- 数据库密码

## 5. 当前版本说明

这个版本已经支持分类、内容、图片配置、界面设置共享。更严格的账号权限，例如超级管理员直接创建 Supabase Auth 用户、强制修改其他用户密码，需要后续增加 Supabase Edge Function，因为这类操作必须使用服务端权限，不能安全地放在 GitHub Pages 前端。
