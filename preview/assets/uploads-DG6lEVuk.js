import{c as d,P as u,s as w,Z as y,$ as g}from"./index-RsvtupLt.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=d("Eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=d("Plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=d("Save",[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=d("Trash2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=d("Upload",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"17 8 12 3 7 8",key:"t8dd8p"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15",key:"widbto"}]]);function W(e=globalThis.crypto,t=()=>Date.now(),i=()=>Math.random()){if(typeof(e==null?void 0:e.randomUUID)=="function")return e.randomUUID();if(typeof(e==null?void 0:e.getRandomValues)=="function"){const a=e.getRandomValues(new Uint8Array(16));a[6]=a[6]&15|64,a[8]=a[8]&63|128;const s=[...a].map(o=>o.toString(16).padStart(2,"0"));return`${s.slice(0,4).join("")}-${s.slice(4,6).join("")}-${s.slice(6,8).join("")}-${s.slice(8,10).join("")}-${s.slice(10).join("")}`}return`${t().toString(36)}-${i().toString(36).slice(2,12)}`}async function $(e,t=2e3,i=.86){if(!e.type.startsWith("image/")||e.type==="image/gif")return e;const a=await createImageBitmap(e),s=Math.min(1,t/Math.max(a.width,a.height)),o=document.createElement("canvas");o.width=Math.max(1,Math.round(a.width*s)),o.height=Math.max(1,Math.round(a.height*s));const c=o.getContext("2d");if(!c)throw new Error("Canvas is unavailable");c.drawImage(a,0,0,o.width,o.height),a.close();const h=await new Promise((m,p)=>o.toBlob(r=>r?m(r):p(new Error("Image conversion failed")),"image/webp",i));return new File([h],e.name.replace(/\.[^.]+$/,".webp"),{type:"image/webp"})}async function E(e,t,i,a,s=u,o=!1){var m;const{data:c}=await w.auth.getSession(),h=(m=c.session)==null?void 0:m.access_token;if(!h)throw new Error("Please sign in before uploading");return new Promise((p,r)=>{const n=new XMLHttpRequest;n.open("POST",`${y}/storage/v1/object/${s}/${t}`),n.setRequestHeader("Authorization",`Bearer ${h}`),n.setRequestHeader("apikey",g),n.setRequestHeader("Content-Type",e.type||"application/octet-stream"),n.setRequestHeader("x-upsert",o?"true":"false"),n.upload.onprogress=l=>i({loaded:l.loaded,total:l.total||e.size,percent:Math.round(l.loaded/(l.total||e.size)*100)}),n.onerror=()=>r(new Error("Upload failed")),n.onabort=()=>r(new DOMException("Upload cancelled","AbortError")),n.onload=()=>{n.status>=200&&n.status<300?p({bucket:s,path:t}):r(new Error(n.responseText||`Upload failed (${n.status})`))},a==null||a.addEventListener("abort",()=>n.abort(),{once:!0}),n.send(e)})}async function U(e){if(!e.type.startsWith("image/"))return{};const t=await createImageBitmap(e),i={width:t.width,height:t.height};return t.close(),i}function P(e){const t=e.name.toLowerCase(),i=e.type.startsWith("image/"),a=["video/mp4","video/webm"].includes(e.type)||t.endsWith(".mp4")||t.endsWith(".webm"),s=["application/pdf","application/zip","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/plain","text/markdown","text/html"].includes(e.type)||t.endsWith(".pdf")||t.endsWith(".zip")||t.endsWith(".docx")||t.endsWith(".xlsx")||t.endsWith(".txt")||t.endsWith(".md")||t.endsWith(".html")||t.endsWith(".htm");if(!i&&!a&&!s)throw new Error(`不支持的文件类型：${e.type||e.name}`);const o=a?2*1024*1024*1024:100*1024*1024;if(e.size>o)throw new Error(a?"视频不能超过 2GB":"单个文件不能超过 100MB");return{image:i,video:a,document:s}}export{b as E,v as P,M as S,f as T,k as U,U as a,$ as i,W as r,E as u,P as v};
