const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/cosUpload-DSRse86C.js","assets/index-aNomBSQG.js","assets/index-BA1P4Uta.css"])))=>i.map(i=>d[i]);
import{c as d,_ as l}from"./index-aNomBSQG.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=d("Eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w=d("ImagePlus",[["path",{d:"M16 5h6",key:"1vod17"}],["path",{d:"M19 2v6",key:"4bpg5p"}],["path",{d:"M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5",key:"1ue2ih"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=d("Plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=d("Save",[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=d("Trash2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=d("Upload",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"17 8 12 3 7 8",key:"t8dd8p"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15",key:"widbto"}]]);function b(e=globalThis.crypto,t=()=>Date.now(),o=()=>Math.random()){if(typeof(e==null?void 0:e.randomUUID)=="function")return e.randomUUID();if(typeof(e==null?void 0:e.getRandomValues)=="function"){const i=e.getRandomValues(new Uint8Array(16));i[6]=i[6]&15|64,i[8]=i[8]&63|128;const r=[...i].map(c=>c.toString(16).padStart(2,"0"));return`${r.slice(0,4).join("")}-${r.slice(4,6).join("")}-${r.slice(6,8).join("")}-${r.slice(8,10).join("")}-${r.slice(10).join("")}`}const a=t().toString(16).padStart(12,"0").slice(-12),s=()=>Math.floor(Math.max(0,Math.min(.9999999999999999,o()))*4294967296).toString(16).padStart(8,"0"),n=`${s()}${s()}${s()}${s()}`;return`${n.slice(0,8)}-${a.slice(0,4)}-4${a.slice(4,7)}-8${n.slice(8,11)}-${n.slice(11,23)}`}function p(e){if(e.purpose==="document-import"&&e.importId)return`imports/${e.importId}/`;if(e.purpose==="content-media"&&e.contentId)return e.path.startsWith(`content/${e.contentId}/`)?`content/${e.contentId}/`:`drafts/${e.contentId}/`;if(e.purpose==="migration"){const t=e.path.split("/")[0];return t?`${t}/`:""}return e.path.slice(0,e.path.lastIndexOf("/")+1)}async function I(e){{const{uploadToCos:t}=await l(async()=>{const{uploadToCos:o}=await import("./cosUpload-DSRse86C.js");return{uploadToCos:o}},__vite__mapDeps([0,1,2]));return t({file:e.file,path:e.path,scope:{purpose:e.purpose,contentId:e.contentId,importId:e.importId,prefix:p(e),visibility:e.visibility},signal:e.signal,onProgress:e.onProgress})}}async function k(e,t=2e3,o=.86){return(await y(e,t,o)).file}async function y(e,t=1600,o=.92){if(!e.type.startsWith("image/")||e.type==="image/gif")return{file:e,width:0,height:0};const a=await createImageBitmap(e);try{const s=Math.min(1,t/Math.max(a.width,a.height)),n=document.createElement("canvas");n.width=Math.max(1,Math.round(a.width*s)),n.height=Math.max(1,Math.round(a.height*s));const i=n.getContext("2d");if(!i)throw new Error("Canvas is unavailable");i.drawImage(a,0,0,n.width,n.height);const r=await new Promise((c,m)=>n.toBlob(h=>h?c(h):m(new Error("Image conversion failed")),"image/webp",o));return{file:new File([r],e.name.replace(/\.[^.]+$/,`-${t}.webp`),{type:"image/webp"}),width:n.width,height:n.height}}finally{a.close()}}async function $(e){if(!e.type.startsWith("image/"))return{};const t=await createImageBitmap(e),o={width:t.width,height:t.height};return t.close(),o}function W(e){const t=e.name.toLowerCase(),o=e.type.startsWith("image/"),a=["video/mp4","video/webm"].includes(e.type)||t.endsWith(".mp4")||t.endsWith(".webm"),s=["application/pdf","application/zip","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/plain","text/markdown","text/html"].includes(e.type)||t.endsWith(".pdf")||t.endsWith(".zip")||t.endsWith(".docx")||t.endsWith(".xlsx")||t.endsWith(".txt")||t.endsWith(".md")||t.endsWith(".html")||t.endsWith(".htm");if(!o&&!a&&!s)throw new Error(`不支持的文件类型：${e.type||e.name}`);const n=a?2*1024*1024*1024:100*1024*1024;if(e.size>n)throw new Error(a?"视频不能超过 2GB":"单个文件不能超过 100MB");return{image:o,video:a,document:s}}function P(e){const t=e.type||(e.name.toLowerCase().endsWith(".webm")?"video/webm":"video/mp4");return typeof document<"u"&&document.createElement("video").canPlayType(t)!==""}export{u as E,w as I,f as P,v as S,x as T,M as U,$ as a,P as b,y as c,k as i,b as r,I as u,W as v};
