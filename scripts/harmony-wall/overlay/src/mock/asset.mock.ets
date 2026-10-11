// Preview-only Asset Store (never committed): keeps secrets in Previewer preferences so a Previewer
// restart keeps the device session. Mirrors only the calls auth/SecretStore.ets makes.

const Tag: Record<string, number> = { 'SECRET': 1, 'ALIAS': 2, 'ACCESSIBILITY': 3, 'SYNC_TYPE': 4, 'RETURN_TYPE': 5 };
const ReturnType: Record<string, number> = { 'ALL': 0, 'ATTRIBUTES': 1 };
const Accessibility: Record<string, number> = { 'DEVICE_POWERED_ON': 0, 'DEVICE_FIRST_UNLOCKED': 1, 'DEVICE_UNLOCKED': 2 };
const SyncType: Record<string, number> = { 'NEVER': 0, 'THIS_DEVICE': 1 };

// In memory for one Previewer run (the Windows Previewer cannot create a preferences directory); never persisted.
class MemStore {
  map: Map<string, string> = new Map<string, string>();
  putSync(k: string, v: string): void { this.map.set(k, v); }
  getSync(k: string, d: string): string { const v: string | undefined = this.map.get(k); return v === undefined ? d : v; }
  deleteSync(k: string): void { this.map.delete(k); }
  async flush(): Promise<void> {}
}
const MEM: MemStore = new MemStore();
function store(): MemStore {
  return MEM;
}

function aliasOf(map: Map<number, Object>): string {
  const bytes = map.get(Tag['ALIAS']) as Uint8Array;
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

function toArray(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(bytes[i]);
  }
  return out;
}

async function put(map: Map<number, Object>, secret: Uint8Array): Promise<void> {
  const s = store();
  s.putSync(aliasOf(map), JSON.stringify(toArray(secret)));
  await s.flush();
}

async function add(attrs: Map<number, Object>): Promise<void> {
  await put(attrs, attrs.get(Tag['SECRET']) as Uint8Array);
}

async function update(query: Map<number, Object>, attrs: Map<number, Object>): Promise<void> {
  await put(query, attrs.get(Tag['SECRET']) as Uint8Array);
}

async function query(q: Map<number, Object>): Promise<Map<number, Object>[]> {
  const raw = store().getSync(aliasOf(q), '');
  if (raw === '') {
    throw new Error('24000002 not found');
  }
  const result: Map<number, Object> = new Map();
  result.set(Tag['SECRET'], new Uint8Array(JSON.parse(raw) as number[]));
  result.set(Tag['ALIAS'], q.get(Tag['ALIAS']) as Object);
  return [result];
}

async function remove(q: Map<number, Object>): Promise<void> {
  const s = store();
  s.deleteSync(aliasOf(q));
  await s.flush();
}

const asset: Record<string, Object> = {
  'Tag': Tag, 'ReturnType': ReturnType, 'Accessibility': Accessibility, 'SyncType': SyncType,
  'add': add, 'update': update, 'query': query, 'remove': remove,
};
export default asset;
