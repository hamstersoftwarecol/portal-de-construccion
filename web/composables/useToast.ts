export function useToast() {
  const items = useState<{ id: number; text: string; kind: string }[]>('toasts', () => [])
  const push = (text: string, kind = 'ok') => {
    const id = Date.now() + Math.random()
    items.value = [...items.value, { id, text, kind }]
    setTimeout(() => { items.value = items.value.filter((t) => t.id !== id) }, 4500)
  }
  return { items, push, error: (e: unknown) => push(e instanceof Error ? e.message : String(e), 'error') }
}
