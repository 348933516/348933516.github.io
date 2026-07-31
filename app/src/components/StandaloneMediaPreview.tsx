import type { ContentMedia } from "../types";
import { standaloneMedia } from "../lib/richMedia";
import { VideoPlayer } from "./VideoPlayer";

export function StandaloneMediaPreview({ bodyHtml, media }: { bodyHtml: string; media: ContentMedia[] }) {
  const items = standaloneMedia(bodyHtml, media);
  if (!items.length) return null;

  return <section className="standalone-media-preview" aria-label="正文媒体">
    <header>
      <strong>正文媒体</strong>
      <span>独立上传的图片和视频会随正文一起显示</span>
    </header>
    <div>
      {items.map((item) => <figure key={item.id}>
        {item.kind === "video"
          ? <div className="media-video-shell"><VideoPlayer media={item} /></div>
          : <img src={item.src} alt={item.altText || item.title} loading="lazy" decoding="async" />}
        <figcaption><strong>{item.title}</strong>{item.note && <p>{item.note}</p>}</figcaption>
      </figure>)}
    </div>
  </section>;
}
