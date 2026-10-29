export type Me = { id: number; email: string; name: string; isAdmin: boolean }
export type Membership = { projectId: number; role: string; name: string }

export function useSession() {
  const user = useState<Me | null>('user', () => null)
  const memberships = useState<Membership[]>('memberships', () => [])
  const loaded = useState('session-loaded', () => false)
  const unread = useState('unread', () => 0)

  async function load() {
    try {
      const r = await api<{ user: Me; memberships: Membership[] }>('/auth/me')
      user.value = r.user; memberships.value = r.memberships
    } catch { user.value = null; memberships.value = [] }
    loaded.value = true
  }
  async function refreshUnread() {
    if (!user.value) return
    try { unread.value = (await api<{ unread: number }>('/notifications/count')).unread } catch {}
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    user.value = null; memberships.value = []
    try { localStorage.removeItem('portal-queue'); const c = await caches.open('portal-api'); (await c.keys()).forEach((k) => c.delete(k)) } catch {}
    navigateTo('/login')
  }
  const isManager = computed(() => !!user.value?.isAdmin || memberships.value.some((m) => ['administrador', 'supervisor'].includes(m.role)))
  return { user, memberships, loaded, unread, load, logout, refreshUnread, isManager }
}
