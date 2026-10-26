export interface AuthUser { id: string; username: string; email: string; }
export interface PlayerProfile extends AuthUser {
  created_at: string; matches_played: number; wins: number; losses: number;
  total_score: string; total_deaths: string;
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    ...options, credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const data: { error?: string } = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
export const auth = {
  register(username: string, email: string, password: string) {
    return request<{ user: AuthUser }>("register", { method:"POST", body:JSON.stringify({username,email,password}) });
  },
  login(email: string, password: string) {
    return request<{ user: AuthUser }>("login", { method:"POST", body:JSON.stringify({email,password}) });
  },
  me() { return request<{ user: AuthUser }>("me"); },
  profile() { return request<{ profile: PlayerProfile }>("profile"); },
  logout() { return request<{ ok: boolean }>("logout", { method:"POST" }); }
};
