# Preview-only (never committed): the Windows Previewer cannot create a preferences directory ("NativePreferences: GetRealPath: Failed to
# create path"), so SettingsStore keeps its values in memory for the length of the run. Usage: patch_prefs.py <SettingsStore.ets>.
import sys
p = sys.argv[1]
s = open(p).read()
if 'MemPreferences' in s:
    sys.exit(0)
cls = """
class MemPreferences {
  map: Map<string, preferences.ValueType> = new Map<string, preferences.ValueType>();
  async put(key: string, value: preferences.ValueType): Promise<void> {
    this.map.set(key, value);
  }
  async get(key: string, defaultValue: preferences.ValueType): Promise<preferences.ValueType> {
    const value: preferences.ValueType | undefined = this.map.get(key);
    return value === undefined ? defaultValue : value;
  }
  async flush(): Promise<void> {}
}
const MEM_PREFERENCES: MemPreferences = new MemPreferences();
"""
marker = "let appContext: common.Context | null = null;"
assert marker in s
s = s.replace(marker, cls + marker, 1)
old = "preferencesInstancePromise = preferences.getPreferences(appContext, options);"
assert old in s
s = s.replace(old, "preferencesInstancePromise = Promise.resolve(MEM_PREFERENCES as Object as preferences.Preferences);", 1)
open(p, 'w').write(s)
