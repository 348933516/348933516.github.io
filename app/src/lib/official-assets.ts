import { safeUrl } from "./sanitize";

export type OfficialAssetKind = "logo" | "background";

export interface OfficialAsset {
  id: string;
  name: string;
  path: string;
  sourceUrl: string;
  kind: OfficialAssetKind;
  description: string;
}

export const officialAssets: OfficialAsset[] = [
  { id: "logo", name: "冒险岛官方标志", path: "official/maplestory-logo.png", sourceUrl: "https://static.web.sdo.com/mxd/pic/mxd/web8/pc/main-logo.png", kind: "logo", description: "适合顶部 Logo 与首页 Logo" },
  { id: "v226", name: "高能蘑菇战令主视觉", path: "official/v226-hero.jpg", sourceUrl: "https://static.web.sdo.com/mxd/pic/mxd_act/v226_2/wrapout.jpg", kind: "background", description: "宽幅角色主视觉，适合首页主背景" },
  { id: "starry", name: "星雨落眉 焕作新颜", path: "official/banner-starry.png", sourceUrl: "https://fu5.web.sdo.com/10036/202607/17842555308600.png", kind: "background", description: "蓝色角色活动横幅" },
  { id: "ponytail", name: "马尾飞扬 暴走青春", path: "official/banner-ponytail.png", sourceUrl: "https://fu5.web.sdo.com/10036/202607/17842555111279.png", kind: "background", description: "明亮角色阵容横幅" },
  { id: "challenge", name: "挑战者世界", path: "official/banner-challenge.png", sourceUrl: "https://fu5.web.sdo.com/10036/202607/17840844468590.png", kind: "background", description: "紫色战斗活动横幅" },
  { id: "ice-song", name: "异星超市 冰之歌", path: "official/banner-ice-song.png", sourceUrl: "https://fu5.web.sdo.com/10036/202607/17841198445887.png", kind: "background", description: "冰蓝色周年活动横幅" },
  { id: "upgrade", name: "斗燃极速升级", path: "official/banner-upgrade.jpg", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17823807163346.jpg", kind: "background", description: "深蓝界面主题横幅" },
  { id: "pass", name: "动力通行证", path: "official/banner-pass.jpg", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17823806948138.jpg", kind: "background", description: "紫蓝色活动横幅" },
  { id: "genesis", name: "创世通行证", path: "official/banner-genesis.jpg", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17823806729872.jpg", kind: "background", description: "暗红角色横幅" },
  { id: "mushroom", name: "高能蘑菇战令", path: "official/banner-mushroom.jpg", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17823806352687.jpg", kind: "background", description: "橙色轻松主题横幅" },
  { id: "recruit", name: "冒险岛抖音主播招募", path: "official/community-recruit.jpg", sourceUrl: "https://fu5.web.sdo.com/10036/202607/17840922913801.jpg", kind: "background", description: "紫色人物主题横幅" },
  { id: "ugc", name: "冒险岛 UGC 激励计划", path: "official/community-ugc.png", sourceUrl: "https://fu5.web.sdo.com/10036/202607/17840911111311.png", kind: "background", description: "黑白角色主题横幅" },
  { id: "fishing", name: "暑假钓鱼活动", path: "official/community-fishing.png", sourceUrl: "https://fu5.web.sdo.com/10036/202607/17833113691775.png", kind: "background", description: "黑金社区活动横幅" },
  { id: "dream", name: "冒险岛圆梦计划", path: "official/community-dream.png", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17822957683986.png", kind: "background", description: "明亮彩色社区横幅" },
  { id: "media-khali", name: "卡莉角色画面", path: "official/media-khali.png", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17818555775855.png", kind: "background", description: "霓虹暗色角色素材" },
  { id: "media-ride", name: "森林骑乘角色画面", path: "official/media-ride.png", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17818555623374.png", kind: "background", description: "蓝色森林角色素材" },
  { id: "media-chess", name: "棋局角色画面", path: "official/media-chess.png", sourceUrl: "https://fu5.web.sdo.com/10036/202606/17818555451608.png", kind: "background", description: "黑白棋局角色素材" }
];

export function officialAssetUrl(path: string) {
  const clean = path.replace(/^\/+/, "");
  return safeUrl(`${import.meta.env.BASE_URL}${clean}`);
}

export function isOfficialAssetPath(path?: string | null) {
  return Boolean(path?.startsWith("official/"));
}
