import { SaveManager } from '../../js/systems/SaveManager.js';
class MemAdapt {
  constructor(initial) { this.store = initial !== undefined ? JSON.stringify(initial) : null; }
  read() { return this.store ? JSON.parse(this.store) : null; }
  write(data) { this.store = JSON.stringify(data); return true; }
  clear() { this.store = null; }
}
const save = new SaveManager(new MemAdapt());
save.load();
save.setSetting('music', false);
save.setSetting('sfx', false);
console.log('store:', save.adapter.store.slice(0, 200));
const raw = JSON.parse(save.adapter.read());
console.log('parsed settings:', JSON.stringify(raw.settings));
