/**
 * Shared admin API utilities.
 * All admin pages use this instead of duplicating fetch helpers.
 */

export function adminFetch(path: string, options: RequestInit = {}) {
  const token = sessionStorage.getItem("aw_admin_token");
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      ...(options.headers ?? {}),
    },
  });
}

export interface AdminInfo {
  id: number;
  email: string;
  name: string;
  role: string;
}

export function getAdminInfo(): AdminInfo | null {
  try {
    return JSON.parse(sessionStorage.getItem("aw_admin_info") ?? "null");
  } catch {
    return null;
  }
}
