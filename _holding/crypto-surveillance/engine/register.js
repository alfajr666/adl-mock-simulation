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

  /** Set one attribute value on one account. */
  set(key, attr, value) { this.byKey[key].attributes[attr] = value; }

  /**
   * Background collisions: each listed account keeps a unique value with probability `unique`,
   * otherwise draws one of the shared pool values (weights need not sum to 1 - they are relative).
   * pools: [{count, weight}] -> `count` pool values each with relative weight `weight`.
   */
  drawPool(keys, attr, prefix, unique, pools) {
    const values = [];
    for (const [pi, p] of pools.entries()) for (let n = 0; n < p.count; n++) values.push({ v: `${prefix}-S${pi}${n}`, w: p.weight });
    const total = values.reduce((s, x) => s + x.w, 0);
    for (const k of keys) {
      if (this.rng.u() < unique) continue;
      let x = this.rng.u() * total;
      let pick = values[values.length - 1].v;
      for (const e of values) { x -= e.w; if (x <= 0) { pick = e.v; break; } }
      this.byKey[k].attributes[attr] = pick;
    }
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
    order.forEach((ei, n) => { idOf[this.entries[ei].key] = `A${String(n + 1).padStart(3, '0')}`; });
    const rows = this.entries.map((e) => ({
      acct: idOf[e.key],
      declaredOwner: e.attributes[this.schema.ownerAttr],
      type: e.type,
      attributes: { ...e.attributes },
    })).sort((a, b) => (a.acct < b.acct ? -1 : 1));
    return {
      idOf,
      register: {
        schema: this.schema.attributes.map((a) => ({ key: a.key, label: a.label, strength: a.strength, rationale: a.rationale, caveat: a.caveat })),
        ownerAttribute: this.schema.ownerAttr,
        rows,
      },
    };
  }
}
