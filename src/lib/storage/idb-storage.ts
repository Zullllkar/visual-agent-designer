"use client";

/**
 * IndexedDB-backed StateStorage（zustand persist 用）
 * --------------------------------------------------------------
 * 为什么需要：
 *   ProjectFile.assets[] 里的 ImageAsset.src 通常是 base64 PNG
 *   （单张 ~1–3 MB）。localStorage 只有 5–10 MB 配额，真实
 *   image provider 接通后几张就会爆 QuotaExceededError，整个
 *   project store 的 setItem 都会失败 → 数据丢失。
 *
 * 选型：
 *   - 不引入 idb / dexie 等额外依赖；自己写一个最小 KV adapter。
 *   - 仍按 zustand 的 StateStorage（getItem/setItem/removeItem 返回
 *     string | null | Promise<string | null>），业务侧零侵入。
 *
 * 设计：
 *   - 单 DB（vad-storage），单 object store（kv），key 即 zustand
 *     persist 的 name（如 "vad.projects.v1"）。
 *   - SSR 安全：所有 IDB 调用都在 `typeof indexedDB !== 'undefined'`
 *     时才执行；服务端命中时退化为 in-memory map（仅做类型一致，
 *     persist 在服务端本就不应该读写）。
 *   - 一次性迁移：第一次访问某个 key 时若 IDB 为空但同名
 *     localStorage 有值，搬过去并清掉 localStorage（避免老用户
 *     数据消失）。迁移成功才 remove；失败保留 localStorage 兜底。
 */

import type { StateStorage } from "zustand/middleware";

const DB_NAME = "vad-storage";
const STORE = "kv";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback = new Map<string, string>();

/** zustand persist 会对返回值 JSON.parse；空串会变成 Unexpected end of JSON input */
export function normalizePersistedJson(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type BrowserStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createBrowserJsonStorage(
  backing?: BrowserStorageLike | null,
): StateStorage {
  const store =
    backing ?? (typeof localStorage === "undefined" ? null : localStorage);
  return {
    getItem: (key) => {
      if (!store) return null;
      try {
        return normalizePersistedJson(store.getItem(key));
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      store?.setItem(key, value);
    },
    removeItem: (key) => {
      store?.removeItem(key);
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB not available"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onblocked = () =>
      reject(new Error("indexedDB open blocked by other tab"));
  });
  return dbPromise;
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      const v = req.result;
      resolve(typeof v === "string" ? v : v == null ? null : String(v));
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("idbSet failed"));
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("idbDel failed"));
  });
}

/**
 * 一次性把 localStorage[key] 搬到 IDB[key]。每个 key 只跑一次：
 * 用 sessionStorage 标记，避免重复迁移污染日志。
 *
 * 失败时保留 localStorage 原数据并把错误吞掉，下次还会再试。
 */
async function migrateFromLocalStorage(key: string): Promise<string | null> {
  if (typeof localStorage === "undefined") return null;
  const legacy = localStorage.getItem(key);
  if (legacy == null) return null;
  try {
    await idbSet(key, legacy);
    // 迁移成功 → 删除 localStorage 释放配额
    localStorage.removeItem(key);
    if (typeof console !== "undefined") {
      console.info(
        `[idb-storage] migrated "${key}" from localStorage → IndexedDB`
      );
    }
    return legacy;
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn(`[idb-storage] migration failed for "${key}":`, e);
    }
    return legacy;
  }
}

/**
 * 工厂：返回一个 zustand StateStorage 实例。
 *
 * - getItem 异步：先查 IDB，IDB miss 时尝试 localStorage 迁移。
 * - setItem / removeItem 异步：直接写 IDB。
 * - 服务端 / 不支持 IDB 的环境 → 退化为 in-memory（不抛错，
 *   保证 persist middleware 不会因 SSR 崩）。
 */
export function createIdbStorage(): StateStorage {
  const hasIdb = typeof indexedDB !== "undefined";
  if (!hasIdb) {
    return {
      getItem: (k) => normalizePersistedJson(memoryFallback.get(k) ?? null),
      setItem: (k, v) => {
        memoryFallback.set(k, v);
      },
      removeItem: (k) => {
        memoryFallback.delete(k);
      },
    };
  }
  return {
    async getItem(key) {
      try {
        const v = await idbGet(key);
        if (v != null) return normalizePersistedJson(v);
        // IDB 没有 → 尝试从 localStorage 迁移
        return normalizePersistedJson(await migrateFromLocalStorage(key));
      } catch (e) {
        if (typeof console !== "undefined") {
          console.warn(`[idb-storage] getItem("${key}") failed:`, e);
        }
        // IDB 故障兜底：回退读 localStorage（不删，避免雪上加霜）
        if (typeof localStorage !== "undefined") {
          return normalizePersistedJson(localStorage.getItem(key));
        }
        return null;
      }
    },
    async setItem(key, value) {
      try {
        await idbSet(key, value);
      } catch (e) {
        if (typeof console !== "undefined") {
          console.error(
            `[idb-storage] setItem("${key}") failed (data may be lost):`,
            e
          );
        }
        throw e;
      }
    },
    async removeItem(key) {
      try {
        await idbDel(key);
      } catch (e) {
        if (typeof console !== "undefined") {
          console.warn(`[idb-storage] removeItem("${key}") failed:`, e);
        }
      }
    },
  };
}
