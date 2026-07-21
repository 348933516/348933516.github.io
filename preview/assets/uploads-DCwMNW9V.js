import{c as m,Z as u,s as y,O as w,M as g}from"./index-7FS7M0um.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=m("Eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=m("ImagePlus",[["path",{d:"M16 5h6",key:"1vod17"}],["path",{d:"M19 2v6",key:"4bpg5p"}],["path",{d:"M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5",key:"1ue2ih"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=m("Plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=m("Save",[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=m("Trash2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=m("Upload",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"17 8 12 3 7 8",key:"t8dd8p"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15",key:"widbto"}]]);function W(e=globalThis.crypto,t=()=>Date.now(),i=()=>Math.random()){if(typeof(e==null?void 0:e.randomUUID)=="function")return e.randomUUID();if(typeof(e==null?void 0:e.getRandomValues)=="function"){const r=e.getRandomValues(new Uint8Array(16));r[6]=r[6]&15|64,r[8]=r[8]&63|128;const d=[...r].map(c=>c.toString(16).padStart(2,"0"));return`${d.slice(0,4).join("")}-${d.slice(4,6).join("")}-${d.slice(6,8).join("")}-${d.slice(8,10).join("")}-${d.slice(10).join("")}`}const a=t().toString(16).padStart(12,"0").slice(-12),o=()=>Math.floor(Math.max(0,Math.min(.9999999999999999,i()))*4294967296).toString(16).padStart(8,"0"),n=`${o()}${o()}${o()}${o()}`;return`${n.slice(0,8)}-${a.slice(0,4)}-4${a.slice(4,7)}-8${n.slice(8,11)}-${n.slice(11,23)}`}async function E(e,t=2e3,i=.86){if(!e.type.startsWith("image/")||e.type==="image/gif")return e;const a=await createImageBitmap(e),o=Math.min(1,t/Math.max(a.width,a.height)),n=document.createElement("canvas");n.width=Math.max(1,Math.round(a.width*o)),n.height=Math.max(1,Math.round(a.height*o));const r=n.getContext("2d");if(!r)throw new Error("Canvas is unavailable");r.drawImage(a,0,0,n.width,n.height),a.close();const d=await new Promise((c,p)=>n.toBlob(h=>h?c(h):p(new Error("Image conversion failed")),"image/webp",i));return new File([d],e.name.replace(/\.[^.]+$/,".webp"),{type:"image/webp"})}async function U(e,t,i,a,o=u,n=!1){var c;const{data:r}=await y.auth.getSession(),d=(c=r.session)==null?void 0:c.access_token;if(!d)throw new Error("Please sign in before uploading");return new Promise((p,h)=>{const s=new XMLHttpRequest;s.open("POST",`${w}/storage/v1/object/${o}/${t}`),s.setRequestHeader("Authorization",`Bearer ${d}`),s.setRequestHeader("apikey",g),s.setRequestHeader("Content-Type",e.type||"application/octet-stream"),s.setRequestHeader("x-upsert",n?"true":"false"),s.upload.onprogress=l=>i({loaded:l.loaded,total:l.total||e.size,percent:Math.round(l.loaded/(l.total||e.size)*100)}),s.onerror=()=>h(new Error("Upload failed")),s.onabort=()=>h(new DOMException("Upload cancelled","AbortError")),s.onload=()=>{s.status>=200&&s.status<300?p({bucket:o,path:t}):h(new Error(s.responseText||`Upload failed (${s.status})`))},a==null||a.addEventListener("abort",()=>s.abort(),{once:!0}),s.send(e)})}async function H(e){if(!e.type.startsWith("image/"))return{};const t=await createImageBitmap(e),i={width:t.width,height:t.height};return t.close(),i}function I(e){const t=e.name.toLowerCase(),i=e.type.startsWith("image/"),a=["video/mp4","video/webm"].includes(e.type)||t.endsWith(".mp4")||t.endsWith(".webm"),o=["application/pdf","application/zip","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/plain","text/markdown","text/html"].includes(e.type)||t.endsWith(".pdf")||t.endsWith(".zip")||t.endsWith(".docx")||t.endsWith(".xlsx")||t.endsWith(".txt")||t.endsWith(".md")||t.endsWith(".html")||t.endsWith(".htm");if(!i&&!a&&!o)throw new Error(`不支持的文件类型：${e.type||e.name}`);const n=a?2*1024*1024*1024:100*1024*1024;if(e.size>n)throw new Error(a?"视频不能超过 2GB":"单个文件不能超过 100MB");return{image:i,video:a,document:o}}export{M as E,b as I,k as P,v as S,f as T,$ as U,H as a,E as i,W as r,U as u,I as v};
