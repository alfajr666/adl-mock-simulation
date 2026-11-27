/*
 * Account register: what the exchange knows about each account.
 * The builder is used by the scenario modules. Hidden ground truth (roles,
 * controller ids) is NOT stored here; the register only holds declared data.
 */
import { streams } from './prng.js';

export class RegisterBuilder {
  /**
   * @param {number} seed
   * @param {{ownerAttr:string, attributes:Array<{key:string,label:string,strength:'strong'|'weak',prefix:string}>}} schema
   */
  constructor(seed, schema) {
    this.schema = schema;
    this.rng = streams(seed)('register');
    this.entries = [];
    this.byKey = {};
    this.used = new Set();
  }

  _fresh(prefix) {
    for (;;) {
      const v = `${prefix}-${String(this.rng.int(100000, 999999))}`;
      if (!this.used.has(v)) { this.used.add(v); return v; }
    }
  }

  /** Add an account with fresh, unique values for every attribute. */
  add(key, type) {
    const attributes = {};
    for (const a of this.schema.attributes) attributes[a.key] = this._fresh(a.prefix);
    const e = { key, type, attributes };
    this.entries.push(e);
    this.byKey[key] = e;
    return e;
  }

  /** Make every listed account carry the same value of `attr` (the first one's). */
  share(keys, attr) {
    const v = this.byKey[keys[0]].attributes[attr];
    for (const k of keys.slice(1)) this.byKey[k].attributes[attr] = v;
  }

  /** Public account ids are assigned in a seeded shuffled order so ids leak nothing. */
  finalize() {
    const order = this.entries.map((_, i) => i);
    this.rng.shuffle(order);
    const idOf = {};
    order.forEach((idx, n) => { idOf[this.entries[idx].key] = `A${String(n + 1).padStart(3, '0')}`; });
    const rows = this.entries.map((e) => ({
      acct: idOf[e.key],
      declaredOwner: e.attributes[this.schema.ownerAttr],
      type: e.type,
      attributes: { ...e.attributes },
    })).sort((a, b) => (a.acct < b.acct ? -1 : 1));
    return {
      idOf,
      register: {
        schema: this.schema.attributes.map((a) => ({ key: a.key, label: a.label, strength: a.strength })),
        ownerAttribute: this.schema.ownerAttr,
        rows,
      },
    };
  }
}
