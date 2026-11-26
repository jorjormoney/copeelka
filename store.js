// Хранилище: Firebase (синхронизация) или локальное (если firebase-config.js не заполнен).
// Интерфейс одинаковый: start(onChange, onAuth), add/update/remove, setMeta, signIn/signOut.

const COLLECTIONS = ["buckets", "deposits", "offers"];

export class LocalStore {
  constructor() {
    this.kind = "local";
    this.key = "kopilka-v1";
    this.state = { meta: {}, buckets: [], deposits: [], offers: [] };
  }
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.state = { meta: {}, buckets: [], deposits: [], offers: [], ...JSON.parse(raw) };
    } catch (e) { /* пустое хранилище */ }
  }
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch (e) { /* без сохранения */ }
    this.onChange && this.onChange(this.snapshot());
  }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  async start(onChange, onAuth) {
    this.onChange = onChange;
    this.load();
    onAuth({ signedIn: true, label: "Локальный режим: данные только в этом браузере" });
    onChange(this.snapshot());
  }
  id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  async add(coll, data) { this.state[coll].push({ ...data, id: this.id() }); this.save(); }
  async update(coll, id, data) { const it = this.state[coll].find((x) => x.id === id); if (it) Object.assign(it, data); this.save(); }
  async remove(coll, id) { this.state[coll] = this.state[coll].filter((x) => x.id !== id); this.save(); }
  async setMeta(data) { this.state.meta = { ...this.state.meta, ...data }; this.save(); }
  async addMany(coll, items) { for (const d of items) this.state[coll].push({ ...d, id: this.id() }); this.save(); }
  async signIn() {}
  async signOut() {}
}

export class FirebaseStore {
  constructor(config) {
    this.kind = "firebase";
    this.config = config;
    this.state = { meta: {}, buckets: [], deposits: [], offers: [] };
    this.unsubs = [];
  }
  async start(onChange, onAuth) {
    const V = "10.12.2";
    const base = `https://www.gstatic.com/firebasejs/${V}/`;
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
    ]);
    this.fs = fs; this.authMod = auth;
    const app = initializeApp(this.config);
    this.auth = auth.getAuth(app);
    try {
      this.db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch (e) {
      this.db = fs.getFirestore(app);
    }
    try { await auth.getRedirectResult(this.auth); } catch (e) { onAuth({ signedIn: false, error: e.message }); }
    auth.onAuthStateChanged(this.auth, (user) => {
      this.unsubs.forEach((u) => u()); this.unsubs = [];
      this.state = { meta: {}, buckets: [], deposits: [], offers: [] };
      if (!user) { onAuth({ signedIn: false }); return; }
      this.uid = user.uid;
      onAuth({ signedIn: true, label: "Вход: " + (user.email || user.displayName || "Google") + " · синхронизация включена" });
      const root = `users/${user.uid}`;
      const ready = new Set();
      const emit = (part) => { ready.add(part); if (ready.size >= 4) onChange(JSON.parse(JSON.stringify(this.state))); };
      for (const c of COLLECTIONS) {
        this.unsubs.push(fs.onSnapshot(fs.collection(this.db, root, c), (snap) => {
          this.state[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          emit(c);
        }, (err) => onAuth({ signedIn: true, error: "Ошибка доступа к данным: " + err.code })));
      }
      this.unsubs.push(fs.onSnapshot(fs.doc(this.db, root, "meta", "settings"), (snap) => {
        this.state.meta = snap.exists() ? snap.data() : {};
        emit("meta");
      }, (err) => onAuth({ signedIn: true, error: "Ошибка доступа к данным: " + err.code })));
    });
  }
  col(c) { return this.fs.collection(this.db, `users/${this.uid}`, c); }
  async add(coll, data) { await this.fs.addDoc(this.col(coll), data); }
  async update(coll, id, data) { await this.fs.updateDoc(this.fs.doc(this.col(coll), id), data); }
  async remove(coll, id) { await this.fs.deleteDoc(this.fs.doc(this.col(coll), id)); }
  async setMeta(data) { await this.fs.setDoc(this.fs.doc(this.db, `users/${this.uid}/meta/settings`), data, { merge: true }); }
  async addMany(coll, items) {
    for (let i = 0; i < items.length; i += 400) {
      const batch = this.fs.writeBatch(this.db);
      for (const d of items.slice(i, i + 400)) batch.set(this.fs.doc(this.col(coll)), d);
      await batch.commit();
    }
  }
  async signIn() {
    const provider = new this.authMod.GoogleAuthProvider();
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return this.authMod.signInWithRedirect(this.auth, provider);
    try { await this.authMod.signInWithPopup(this.auth, provider); }
    catch (e) {
      if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) return this.authMod.signInWithRedirect(this.auth, provider);
      throw e;
    }
  }
  async signOut() { await this.authMod.signOut(this.auth); }
}
