const SIGNATURE_DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;

export type SignatureDraftPoint = { x: number; y: number };
export type SignatureDraftStroke = { points: SignatureDraftPoint[] };

type SignatureDraftRecord = {
  key: string;
  userId: string;
  collectionId: string;
  memberId: string;
  settingsVersion: number;
  captureVersion: number;
  saveRequestId?: string;
  canvasSize: { width: number; height: number };
  strokes: SignatureDraftStroke[];
  savedAt: number;
  expiresAt: number;
};

type SignatureDraftIdentity = Pick<
  SignatureDraftRecord,
  "userId" | "collectionId" | "memberId" | "settingsVersion"
>;

const DB_NAME = "gear-tracker-signatures";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

export function signatureDraftKey(
  userId: string,
  collectionId: string,
  memberId: string,
  settingsVersion: number,
  captureVersion: number,
): string {
  return `${userId}:${collectionId}:${memberId}:${settingsVersion}:${captureVersion}`;
}

export function signatureDraftMatchesMember(
  draft: SignatureDraftIdentity,
  identity: SignatureDraftIdentity,
): boolean {
  return draft.userId === identity.userId
    && draft.collectionId === identity.collectionId
    && draft.memberId === identity.memberId
    && draft.settingsVersion === identity.settingsVersion;
}

export function isFreshSignatureDraft(
  draft: Pick<SignatureDraftRecord, "expiresAt">,
  now = Date.now(),
): boolean {
  return draft.expiresAt > now;
}

export function buildSignatureDraft(
  input: Omit<SignatureDraftRecord, "savedAt" | "expiresAt">,
  now = Date.now(),
): SignatureDraftRecord {
  return {
    ...input,
    savedAt: now,
    expiresAt: now + SIGNATURE_DRAFT_TTL_MS,
  };
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveSignatureDraft(record: SignatureDraftRecord): Promise<void> {
  const db = await openDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft save failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft save aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadSignatureDraft(
  key: string,
  now = Date.now(),
  identity?: SignatureDraftIdentity,
): Promise<SignatureDraftRecord | null> {
  const loaded = await readSignatureDraft(key);
  let record: SignatureDraftRecord | null = loaded ?? null;
  if (record && identity && !signatureDraftMatchesMember(record, identity)) record = null;
  if ((!record || !isFreshSignatureDraft(record, now)) && identity) {
    record = await findFreshSignatureDraft(identity, now);
  }

  if (!record || !isFreshSignatureDraft(record, now)) {
    if (record) await deleteSignatureDraft(key);
    return null;
  }
  return record;
}

async function readSignatureDraft(key: string): Promise<SignatureDraftRecord | undefined> {
  const db = await openDraftDb();
  try {
    return await new Promise<SignatureDraftRecord | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as SignatureDraftRecord | undefined);
      request.onerror = () => reject(request.error ?? new Error("Draft load failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft load aborted"));
    });
  } finally {
    db.close();
  }
}

async function findFreshSignatureDraft(
  identity: SignatureDraftIdentity,
  now: number,
): Promise<SignatureDraftRecord | null> {
  const db = await openDraftDb();
  let records: SignatureDraftRecord[] = [];
  try {
    records = await new Promise<SignatureDraftRecord[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as SignatureDraftRecord[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error("Draft recovery failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft recovery aborted"));
    });
  } finally {
    db.close();
  }

  return records
    .filter((record) => signatureDraftMatchesMember(record, identity) && isFreshSignatureDraft(record, now))
    .sort((left, right) => right.savedAt - left.savedAt)[0] ?? null;
}

async function deleteSignatureDraft(key: string): Promise<void> {
  const db = await openDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft delete failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft delete aborted"));
    });
  } finally {
    db.close();
  }
}

export async function deleteSignatureDraftsForMember(identity: SignatureDraftIdentity): Promise<void> {
  const db = await openDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        for (const record of (request.result as SignatureDraftRecord[]) ?? []) {
          if (signatureDraftMatchesMember(record, identity)) store.delete(record.key);
        }
      };
      request.onerror = () => reject(request.error ?? new Error("Draft cleanup failed"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft cleanup failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft cleanup aborted"));
    });
  } finally {
    db.close();
  }
}
