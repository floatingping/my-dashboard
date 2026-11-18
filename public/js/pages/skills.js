import { api, fmtTime } from "../common.js";
import { bootPage, notify } from "../components.js";

const CONTENT_PLACEHOLDER = [
  "## 什麼時候用",
  "寫 Node.js + Express 後端 API 時。",
  "",
  "## 做法",
  "- 使用 ES modules",
  "- 分 controllers / services / handlers / repos",
  "- 字串用雙引號或樣板字串",
  "",
  "## 完成前檢查",
  "- 實際啟動並用 curl 測過"
].join("\n");

function blankForm() {
  return { name: "", description: "", content: "" };
}

const SkillsPage = {
  data() {
    return {
      skills: [],
      selectedId: null,
      form: blankForm(),
      filter: "",
      preview: false,
      saving: false,
      editing: false,
      contentPlaceholder: CONTENT_PLACEHOLDER
    };
  },
  computed: {
    filtered() {
      const q = this.filter.trim().toLowerCase();
      if (!q) return this.skills;
      return this.skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    },
    isNew() {
      return !this.selectedId;
    },
    editorTitle() {
      return this.isNew ? "新增 skill" : `編輯 ${this.form.name}`;
    },
    selected() {
      return this.skills.find((s) => s.id === this.selectedId) ?? null;
    },
    // 手機上一次只顯示清單或編輯器
    listClass() {
      return this.editing ? "hidden lg:block" : "block";
    },
    editorClass() {
      return this.editing ? "block" : "hidden lg:block";
    },
    saveLabel() {
      return this.saving ? "儲存中…" : "儲存";
    },
    previewLabel() {
      return this.preview ? "編輯" : "預覽";
    }
  },
  async mounted() {
    await this.load();
  },
  methods: {
    async load() {
      this.skills = await api("/skills");
    },
    itemClass(skill) {
      return skill.id === this.selectedId ? "bg-slate-900 text-white" : "hover:bg-slate-100";
    },
    creatorLabel(skill) {
      if (!skill.created_by_name) return "";
      return skill.created_by_agent ? `🤖 ${skill.created_by_name} 建立` : `👤 ${skill.created_by_name} 建立`;
    },
    select(skill) {
      this.selectedId = skill.id;
      this.form = { name: skill.name, description: skill.description, content: skill.content };
      this.preview = false;
      this.editing = true;
    },
    startNew() {
      this.selectedId = null;
      this.form = blankForm();
      this.preview = false;
      this.editing = true;
    },
    async save() {
      this.saving = true;
      try {
        const saved = this.isNew
          ? await api("/skills", { method: "POST", body: this.form })
          : await api(`/skills/${this.selectedId}`, { method: "PATCH", body: this.form });
        notify("已儲存", "success");
        await this.load();
        this.selectedId = saved.id;
      } catch (err) {
        notify(err.message, "error");
      } finally {
        this.saving = false;
      }
    },
    async remove() {
      if (!confirm(`確定要刪除 skill「${this.form.name}」嗎？看板設定裡的這個 skill 也會一起拿掉。`)) return;
      try {
        await api(`/skills/${this.selectedId}`, { method: "DELETE" });
        notify("已刪除", "success");
        await this.load();
        this.startNew();
        this.editing = false;
      } catch (err) {
        notify(err.message, "error");
      }
    },
    fmtTime
  },
  template: `
    <main class="mx-auto max-w-7xl px-4 py-6">
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Skills</h1>
          <p class="text-sm text-slate-500">用文字描述 agent 的專業做法（例如 nodejs-express、dotnet10、vuejs），PM 派 agent 時會附上</p>
        </div>
        <button class="btn btn-primary ml-auto" @click="startNew">＋ 新增 skill</button>
      </div>

      <div class="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside class="card p-3" :class="listClass">
          <input v-model="filter" class="input mb-2" placeholder="搜尋 skill">
          <p v-if="!filtered.length" class="p-4 text-center text-sm text-slate-400">沒有 skill</p>
          <button v-for="s in filtered" :key="s.id" class="block w-full rounded-lg px-3 py-2 text-left" :class="itemClass(s)" @click="select(s)">
            <div class="mono text-sm font-semibold">{{ s.name }}</div>
            <div class="line-clamp-2 text-xs opacity-70">{{ s.description }}</div>
            <div class="mt-0.5 text-[11px] opacity-60">{{ creatorLabel(s) }}</div>
          </button>
        </aside>

        <section class="card p-5" :class="editorClass">
          <div class="mb-4 flex items-center gap-2">
            <button class="btn btn-ghost btn-sm lg:hidden" @click="editing = false">← 清單</button>
            <h2 class="font-semibold text-slate-800">{{ editorTitle }}</h2>
            <span v-if="selected" class="ml-auto text-xs text-slate-400">更新於 {{ fmtTime(selected.updated_at) }}</span>
          </div>
          <form class="space-y-4" @submit.prevent="save">
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="label">名稱</label>
                <input v-model="form.name" class="input mono" required maxlength="64" placeholder="例如：nodejs-express">
              </div>
              <div>
                <label class="label">一句話說明</label>
                <input v-model="form.description" class="input" maxlength="500" placeholder="PM 挑 skill 時看的說明">
              </div>
            </div>
            <div>
              <div class="mb-1.5 flex items-center">
                <label class="label mb-0">內容（Markdown）</label>
                <button type="button" class="btn btn-ghost btn-sm ml-auto" @click="preview = !preview">{{ previewLabel }}</button>
              </div>
              <textarea v-if="!preview" v-model="form.content" class="input mono" rows="16" :placeholder="contentPlaceholder"></textarea>
              <div v-else class="min-h-64 rounded-lg border border-slate-200 p-4"><MdView :source="form.content" /></div>
            </div>
            <div class="flex gap-2">
              <button v-if="!isNew" type="button" class="btn btn-danger" @click="remove">刪除</button>
              <button class="btn btn-primary ml-auto" :disabled="saving">{{ saveLabel }}</button>
            </div>
          </form>
        </section>
      </div>
    </main>`
};

bootPage(SkillsPage, { active: "skills" });
