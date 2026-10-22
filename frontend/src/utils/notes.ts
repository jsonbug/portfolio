/**
 * 按项目分组笔记：前台笔记树（`NoteTree.vue`）与后台笔记列表共用一份口径。
 *
 * 两处各写一遍的后果很具体：同一个项目在前台树上写「3」、在后台下拉里写「4」，
 * 然后没人说得清哪个是对的。分组顺序保持入参顺序（后端按时间倒序返回）。
 */
export interface NoteGroup<T> {
  /** 分组键：默认项目 slug；后台按 `project_id` 过滤时传 `keyOf` 取 id。 */
  key: string
  /** 展示名（项目名）。 */
  name: string
  /** 该分组下的笔记数 —— 后台下拉的「项目名（N）」直接用它。 */
  count: number
  notes: T[]
}

interface GroupableNote {
  project: { slug: string; name: string }
}

export function groupNotesByProject<T extends GroupableNote>(
  notes: T[],
  keyOf: (note: T) => string = (note) => note.project.slug,
): NoteGroup<T>[] {
  const map = new Map<string, NoteGroup<T>>()
  for (const note of notes) {
    const key = keyOf(note)
    const group = map.get(key) ?? { key, name: note.project.name, count: 0, notes: [] }
    group.notes.push(note)
    group.count = group.notes.length
    map.set(key, group)
  }
  return [...map.values()]
}
