const envApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = envApiBaseUrl || `${window.location.protocol}//${window.location.hostname}:8000/api`;
const API_TOKEN_KEY = "local-ai-ops-token";
let memoryAuthToken = "";

export class ApiAuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "ApiAuthError";
  }
}

export function getAuthToken(): string {
  if (memoryAuthToken) {
    return memoryAuthToken;
  }
  const storedToken = readTokenFromStorage("localStorage") || readTokenFromStorage("sessionStorage");
  memoryAuthToken = storedToken;
  return storedToken;
}

export function setAuthToken(token: string): void {
  memoryAuthToken = token;
  writeTokenToStorage("localStorage", token);
  writeTokenToStorage("sessionStorage", token);
}

export function clearAuthToken(): void {
  memoryAuthToken = "";
  removeTokenFromStorage("localStorage");
  removeTokenFromStorage("sessionStorage");
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: authHeaders()
  });
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : `HTTP ${response.status}`;
    if (response.status === 401) {
      throw new ApiAuthError(detail);
    }
    throw new Error(detail);
  }
  return payload as T;
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...authHeaders()
  };
}

type BrowserStorageName = "localStorage" | "sessionStorage";

function getBrowserStorage(name: BrowserStorageName): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window[name] ?? null;
  } catch {
    return null;
  }
}

function readTokenFromStorage(name: BrowserStorageName): string {
  try {
    return getBrowserStorage(name)?.getItem(API_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeTokenToStorage(name: BrowserStorageName, token: string): void {
  try {
    getBrowserStorage(name)?.setItem(API_TOKEN_KEY, token);
  } catch {
    // Keep the in-memory token even when browser storage is unavailable.
  }
}

function removeTokenFromStorage(name: BrowserStorageName): void {
  try {
    getBrowserStorage(name)?.removeItem(API_TOKEN_KEY);
  } catch {
    // Storage cleanup is best-effort; memoryAuthToken is the source of truth for this session.
  }
}
