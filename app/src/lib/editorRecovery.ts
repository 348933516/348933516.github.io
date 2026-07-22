import type { ContentDraft } from "../types";
import type { RichEditorSnapshot } from "../components/RichEditor";

const databaseName = "maplestorynk-editor-recovery";
const storeName = "drafts";

export interface EditorRecoveryRecord {
  contentId: string;
  version: number;
  savedAt: number;
  draft: ContentDraft;
}

function openRecoveryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "contentId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open editor recovery storage"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openRecoveryDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Editor recovery storage failed"));
    });
  } finally {
    database.close();
  }
}

export async function readEditorRecovery(contentId: string) {
  if (!contentId || typeof indexedDB === "undefined") return null;
  try {
    return await withStore<EditorRecoveryRecord | undefined>("readonly", (store) => store.get(contentId)) || null;
  } catch {
    return null;
  }
}

export async function saveEditorRecovery(contentId: string, draft: ContentDraft, snapshot: RichEditorSnapshot) {
  if (!contentId || typeof indexedDB === "undefined") return;
  const record: EditorRecoveryRecord = {
    contentId,
    version: draft.version || 1,
    savedAt: Date.now(),
    draft: { ...draft, bodyHtml: snapshot.html, bodyText: snapshot.text, bodyJson: snapshot.json }
  };
  await withStore<IDBValidKey>("readwrite", (store) => store.put(record));
}

export async function clearEditorRecovery(contentId: string) {
  if (!contentId || typeof indexedDB === "undefined") return;
  try { await withStore<undefined>("readwrite", (store) => store.delete(contentId)); } catch { /* recovery is best effort */ }
}
