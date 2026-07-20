# 腾讯云点播配置

网站已接入腾讯云点播上传接口，但密钥不会放进代码。完成以下配置后，后台视频上传会自动启用。

1. 在腾讯云开通“云点播 VOD”，创建一个输出 H.264/AAC 和 HLS 的任务流。
2. 创建仅有云点播上传和读取权限的子账号密钥，不使用主账号密钥。
3. 在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 新增：
   - `TENCENT_VOD_SECRET_ID`
   - `TENCENT_VOD_SECRET_KEY`
   - `TENCENT_VOD_APP_ID`
   - `TENCENT_VOD_SUB_APP_ID`，未使用子应用时留空
   - `TENCENT_VOD_PROCEDURE`，填写任务流名称
4. 重新运行 `Deploy Supabase backend`。

部署后，`vod-signature` 只为已登录的超级管理员、编辑和上传员生成一小时有效签名。Secret Key 不会发送给浏览器。
