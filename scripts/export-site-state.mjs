import fs from "node:fs/promises";
import path from "node:path";

const url = process.env.SUPABASE_URL || "https://edznwgvyqpsibnkqqeby.supabase.co";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_kuMMovS2ZpF7w9lkiK86Ww_VKkgdgao";
const response = await fetch(`${url}/rest/v1/site_state?id=eq.main&select=*`, { headers: { apikey: key } });
if (!response.ok) throw new Error(`Backup failed: ${response.status} ${await response.text()}`);
const rows = await response.json();
if (!rows[0]) throw new Error("site_state main row was not found");
const directory = path.resolve("local-backups");
await fs.mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = path.join(directory, `site-state-${stamp}.json`);
await fs.writeFile(filename, JSON.stringify(rows[0], null, 2), "utf8");
console.log(`Backup written: ${filename}`);
console.log(`Categories: ${rows[0].data?.categories?.length || 0}; contents: ${rows[0].data?.contents?.length || 0}`);
