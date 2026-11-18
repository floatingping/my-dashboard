// 共用的 Vue 元件（模板用樣板字串，模板裡不放 JS 字串常數，字串都放在 data / methods）
import { createApp, reactive } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, goLogin, RUN_STATUS, STATUS_MAP, uploadFile } from "./common.js";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(String(source ?? "")));
}

let mermaidLoading = null;
let mermaidSeq = 0;
function loadMermaid() {
  if (!mermaidLoading) {
    mermaidLoading = import("/vendor/mermaid/mermaid.esm.min.mjs").then((mod) => {
      mod.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
      return mod.default;
    });
  }
  return mermaidLoading;
}

// ---------- 提示訊息 ----------

const toasts = reactive([]);

export function notify(message, type = "info") {
  const id = Date.now() + Math.random();
  toasts.push({ id, message, type });
  setTimeout(() => {
    const index = toasts.findIndex((t) => t.id === id);
    if (index >= 0) toasts.splice(index, 1);
  }, 3500);
}

export const ToastHost = {
  setup() {
    return { toasts };
  },
  methods: {
    toastClass(toast) {
      if (toast.type === "error") return "bg-red-600";
      if (toast.type === "success") return "bg-emerald-600";
      return "bg-slate-900";
    }
  },
  template: `
    <div class="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
      <div v-for="toast in toasts" :key="toast.id"
        class="pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm text-white shadow-lg" :class="toastClass(toast)">
        {{ toast.message }}
      </div>
    </div>`
};

// ---------- 導覽列 ----------

export const AppNav = {
  props: { user: Object, active: String },
  data() {
    return {
      open: false,
      links: [
        { key: "boards", href: "/", label: "看板" },
        { key: "skills", href: "/skills", label: "Skills" },
        { key: "users", href: "/users", label: "使用者" }
      ]
    };
  },
  methods: {
    linkClass(link) {
      return link.key === this.active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900";
    },
    async logout() {
      await api("/auth/logout", { method: "POST" });
      location.href = "/login";
    }
  },
  template: `
    <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <a href="/" class="flex items-center gap-2 font-bold text-slate-900">
          <span class="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm text-white">K</span>
          <span>Agent 看板</span>
        </a>
        <nav class="ml-6 hidden gap-1 md:flex">
          <a v-for="link in links" :key="link.key" :href="link.href"
            class="rounded-md px-3 py-1.5 text-sm font-medium" :class="linkClass(link)">{{ link.label }}</a>
        </nav>
        <div v-if="user" class="ml-auto hidden items-center gap-2 md:flex">
          <span class="text-sm text-slate-500">👤 {{ user.name }}</span>
          <button class="btn btn-ghost btn-sm" @click="logout">登出</button>
        </div>
        <button class="btn btn-ghost btn-sm ml-auto md:hidden" @click="open = !open" aria-label="選單">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
      <div v-if="open" class="border-t border-slate-200 bg-white px-4 py-2 md:hidden">
        <a v-for="link in links" :key="link.key" :href="link.href"
          class="block rounded-md px-3 py-2 text-sm font-medium" :class="linkClass(link)">{{ link.label }}</a>
        <div v-if="user" class="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
          <span class="text-sm text-slate-500">👤 {{ user.name }}</span>
          <button class="btn btn-ghost btn-sm" @click="logout">登出</button>
        </div>
      </div>
    </header>`
};

// ---------- Markdown（含圖片、mermaid 流程圖）----------

export const MdView = {
  props: { source: String },
  computed: {
    html() {
      return renderMarkdown(this.source);
    }
  },
  mounted() {
    this.enhance();
  },
  updated() {
    this.enhance();
  },
  methods: {
    async enhance() {
      const root = this.$el;
      if (!root?.querySelectorAll) return;
      for (const a of root.querySelectorAll("a")) {
        a.target = "_blank";
        a.rel = "noopener";
      }
      for (const img of root.querySelectorAll("img")) {
        img.loading = "lazy";
        if (!img.closest("a")) img.onclick = () => window.open(img.src, "_blank");
      }
      const blocks = [...root.querySelectorAll("pre > code.language-mermaid")];
      if (!blocks.length) return;
      const mermaid = await loadMermaid();
      for (const code of blocks) {
        const pre = code.parentElement;
        if (!pre?.isConnected) continue;
        try {
          mermaidSeq += 1;
          const { svg } = await mermaid.render(`mermaid-${mermaidSeq}`, code.textContent);
          const box = document.createElement("div");
          box.className = "mermaid-diagram";
          box.innerHTML = svg;
          pre.replaceWith(box);
        } catch (err) {
          pre.classList.add("mermaid-error");
          pre.title = `流程圖語法錯誤：${err.message}`;
        }
      }
    }
  },
  template: `<div class="md" v-html="html"></div>`
};

// ---------- 留言框（可上傳、貼上、拖曳圖片）----------

export const Composer = {
  props: {
    placeholder: String,
    submitLabel: { type: String, default: "送出" },
    busy: Boolean,
    rows: { type: Number, default: 4 }
  },
  emits: ["submit"],
  data() {
    return { text: "", uploading: 0, preview: false, dragging: false, error: "", emptyPreview: "（沒有內容）" };
  },
  computed: {
    canSubmit() {
      return Boolean(this.text.trim()) && !this.busy && !this.uploading;
    },
    frameClass() {
      return this.dragging ? "border-blue-400 ring-2 ring-blue-200" : "border-slate-300";
    }
  },
  methods: {
    tabClass(isPreview) {
      return this.preview === isPreview ? "bg-slate-100 text-slate-900" : "text-slate-500";
    },
    pick() {
      this.$refs.file.click();
    },
    onFileInput(event) {
      this.uploadAll([...event.target.files]);
      event.target.value = "";
    },
    onPaste(event) {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        this.uploadAll(files);
      }
    },
    onDrop(event) {
      this.dragging = false;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length) this.uploadAll(files);
    },
    async uploadAll(files) {
      for (const file of files) {
        this.uploading += 1;
        this.error = "";
        try {
          const saved = await uploadFile(file);
          this.insert(saved.markdown);
        } catch (err) {
          this.error = err.message;
        } finally {
          this.uploading -= 1;
        }
      }
    },
    insert(snippet) {
      const el = this.$refs.input;
      const start = el?.selectionStart ?? this.text.length;
      const end = el?.selectionEnd ?? this.text.length;
      const before = this.text.slice(0, start);
      const after = this.text.slice(end);
      const gap = before && !before.endsWith("\n") ? "\n" : "";
      this.text = `${before}${gap}${snippet}\n${after}`;
      this.preview = false;
      this.$nextTick(() => el?.focus());
    },
    onKey(event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) this.submit();
    },
    submit() {
      if (!this.canSubmit) return;
      this.$emit("submit", this.text.trim(), () => {
        this.text = "";
        this.preview = false;
      });
    }
  },
  template: `
    <div class="rounded-xl border bg-white" :class="frameClass"
      @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
      <div class="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5">
        <button type="button" class="btn btn-ghost btn-sm" :class="tabClass(false)" @click="preview = false">編輯</button>
        <button type="button" class="btn btn-ghost btn-sm" :class="tabClass(true)" @click="preview = true">預覽</button>
        <span v-if="uploading" class="ml-2 text-xs text-slate-500">上傳中…</span>
        <button type="button" class="btn btn-ghost btn-sm ml-auto" title="上傳檔案或圖片" @click="pick">📎 附檔</button>
        <input ref="file" type="file" multiple class="hidden" @change="onFileInput">
      </div>
      <textarea v-show="!preview" ref="input" v-model="text" :rows="rows" :placeholder="placeholder"
        class="block w-full resize-y rounded-none border-0 bg-transparent px-3 py-2 text-sm outline-none"
        @paste="onPaste" @keydown="onKey"></textarea>
      <div v-if="preview" class="min-h-24 px-3 py-2"><MdView :source="text || emptyPreview" /></div>
      <div class="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2">
        <span class="hidden text-xs text-slate-400 sm:inline">支援 Markdown、mermaid；可貼上或拖曳圖片；Ctrl+Enter 送出</span>
        <span v-if="error" class="text-xs text-red-600">{{ error }}</span>
        <button type="button" class="btn btn-primary btn-sm ml-auto" :disabled="!canSubmit" @click="submit">{{ submitLabel }}</button>
      </div>
    </div>`
};

// ---------- 標籤 ----------

export const StatusBadge = {
  props: { status: String },
  computed: {
    meta() {
      return STATUS_MAP[this.status] ?? { label: this.status, color: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" };
    }
  },
  template: `
    <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
      :class="meta.color" :title="meta.label">
      <span class="h-1.5 w-1.5 rounded-full" :class="meta.dot"></span>{{ status }}
    </span>`
};

export const RunBadge = {
  props: { status: String },
  computed: {
    meta() {
      return RUN_STATUS[this.status] ?? RUN_STATUS.failed;
    }
  },
  template: `
    <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset" :class="meta.color">
      <span class="h-1.5 w-1.5 rounded-full" :class="meta.dot"></span>{{ meta.label }}
    </span>`
};

// ---------- 對話框（手機是底部滑出）----------

export const Modal = {
  props: { title: String, wide: Boolean },
  emits: ["close"],
  computed: {
    sizeClass() {
      return this.wide ? "sm:max-w-3xl" : "sm:max-w-lg";
    }
  },
  mounted() {
    this.onKey = (event) => {
      if (event.key === "Escape") this.close();
    };
    window.addEventListener("keydown", this.onKey);
    document.body.classList.add("overflow-hidden");
  },
  unmounted() {
    window.removeEventListener("keydown", this.onKey);
    document.body.classList.remove("overflow-hidden");
  },
  methods: {
    close() {
      this.$emit("close");
    }
  },
  template: `
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" @click.self="close">
      <div class="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" :class="sizeClass">
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 class="font-semibold text-slate-900">{{ title }}</h3>
          <button class="btn btn-ghost btn-sm" aria-label="關閉" @click="close">✕</button>
        </div>
        <div class="overflow-y-auto p-5"><slot></slot></div>
      </div>
    </div>`
};

// ---------- skill 多選 ----------

export const SkillPicker = {
  props: {
    modelValue: { type: Array, default: () => [] },
    skills: { type: Array, default: () => [] }
  },
  emits: ["update:modelValue"],
  methods: {
    toggle(name) {
      const next = new Set(this.modelValue);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      this.$emit("update:modelValue", [...next]);
    },
    chipClass(name) {
      return this.modelValue.includes(name)
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-300 bg-white text-slate-700 hover:border-slate-500";
    }
  },
  template: `
    <div class="flex flex-wrap gap-2">
      <button v-for="skill in skills" :key="skill.name" type="button"
        class="rounded-full border px-3 py-1 text-sm transition" :class="chipClass(skill.name)"
        :title="skill.description" @click="toggle(skill.name)">{{ skill.name }}</button>
      <span v-if="!skills.length" class="text-sm text-slate-400">還沒有 skill，可以先到 Skills 頁建立</span>
    </div>`
};

// ---------- 頁面啟動 ----------

// 每個頁面都用這個掛載：檢查登入、加上導覽列和共用元件
export async function bootPage(Page, { active = "" } = {}) {
  const state = await api("/auth/state");
  if (!state.user) {
    goLogin();
    return;
  }
  const app = createApp({
    components: { AppNav, ToastHost, Page },
    data() {
      return { user: state.user, active };
    },
    template: `
      <div class="min-h-screen">
        <AppNav :user="user" :active="active" />
        <Page :user="user" />
        <ToastHost />
      </div>`
  });
  app.component("MdView", MdView);
  app.component("Composer", Composer);
  app.component("StatusBadge", StatusBadge);
  app.component("RunBadge", RunBadge);
  app.component("Modal", Modal);
  app.component("SkillPicker", SkillPicker);
  app.mount("#app");
}
