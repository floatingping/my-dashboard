import { api, query } from "../common.js";
import { bootPage, notify } from "../components.js";

const CRON_PRESETS = [
  { label: "每 1 分鐘", value: "*/1 * * * *" },
  { label: "每 5 分鐘", value: "*/5 * * * *" },
  { label: "每 15 分鐘", value: "*/15 * * * *" },
  { label: "每 30 分鐘", value: "*/30 * * * *" },
  { label: "每小時", value: "0 * * * *" }
];

const PM_PROMPT_PLACEHOLDER = [
  "給 PM 的額外指示，例如：",
  "- 這個看板負責公司官網，技術是 Vue 3 + Express",
  "- 寫程式的票派 Coder，研究的票派 Researcher",
  "- 每張票完成後 result 要附上檔案路徑"
].join("\n");

function blankForm() {
  return {
    title: "",
    description: "",
    folder: "",
    pm_name: "",
    pm_prompt: "",
    pm_skills: [],
    allowed_skills: [],
    cron: "*/5 * * * *",
    pm_model: "",
    worker_model: "",
    max_workers: 1,
    max_turns: 40,
    enabled: true
  };
}

const BoardEditPage = {
  data() {
    return {
      boardId: Number(query("id")) || null,
      form: blankForm(),
      skills: [],
      models: [],
      defaultModel: "",
      presets: CRON_PRESETS,
      pmPromptPlaceholder: PM_PROMPT_PLACEHOLDER,
      loading: true,
      saving: false,
      deleteText: ""
    };
  },
  computed: {
    isNew() {
      return !this.boardId;
    },
    pageTitle() {
      return this.isNew ? "新增看板" : "看板設定";
    },
    backLink() {
      return this.isNew ? "/" : `/board?id=${this.boardId}`;
    },
    defaultModelLabel() {
      return `預設（${this.defaultModel}）`;
    },
    canDelete() {
      return this.deleteText.trim() === this.form.title;
    },
    saveLabel() {
      if (this.saving) return "儲存中…";
      return this.isNew ? "建立看板" : "儲存";
    }
  },
  async mounted() {
    try {
      const [skills, models] = await Promise.all([api("/skills"), api("/models")]);
      this.skills = skills;
      this.models = models.models;
      this.defaultModel = models.default;
      if (!this.isNew) {
        const board = await api(`/boards/${this.boardId}`);
        for (const key of Object.keys(this.form)) {
          if (board[key] !== undefined) this.form[key] = board[key];
        }
        document.title = `${board.title} 設定 · Agent 看板`;
      }
    } catch (err) {
      notify(err.message, "error");
    } finally {
      this.loading = false;
    }
  },
  methods: {
    presetClass(preset) {
      return preset.value === this.form.cron
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-300 text-slate-600 hover:border-slate-500";
    },
    async save() {
      this.saving = true;
      try {
        const body = { ...this.form, pm_name: this.form.pm_name.trim() || undefined };
        const board = this.isNew
          ? await api("/boards", { method: "POST", body })
          : await api(`/boards/${this.boardId}`, { method: "PATCH", body });
        location.href = `/board?id=${board.id}`;
      } catch (err) {
        notify(err.message, "error");
      } finally {
        this.saving = false;
      }
    },
    async remove() {
      if (!this.canDelete) return;
      try {
        await api(`/boards/${this.boardId}`, { method: "DELETE" });
        location.href = "/";
      } catch (err) {
        notify(err.message, "error");
      }
    }
  },
  template: `
    <main class="mx-auto max-w-4xl px-4 py-6">
      <a :href="backLink" class="text-sm text-slate-500 hover:text-slate-800">← 返回</a>
      <h1 class="mt-1 text-2xl font-bold text-slate-900">{{ pageTitle }}</h1>
      <p v-if="loading" class="py-20 text-center text-slate-400">載入中…</p>

      <form v-else class="mt-4 space-y-4" @submit.prevent="save">
        <section class="card space-y-4 p-5">
          <h2 class="font-semibold text-slate-800">基本資料</h2>
          <div>
            <label class="label">標題</label>
            <input v-model="form.title" class="input" required maxlength="100" placeholder="例如：官網改版">
          </div>
          <div>
            <label class="label">說明</label>
            <textarea v-model="form.description" class="input" rows="3" placeholder="這個看板在做什麼"></textarea>
          </div>
          <div>
            <label class="label">工作資料夾</label>
            <input v-model="form.folder" class="input mono" placeholder="例如：C:\\Users\\me\\projects\\website（留空會自動建立）">
            <p class="hint">工作 agent 在這裡讀寫檔案、執行指令；PM 驗收通過後在這裡 git commit（還不是 git repo 會自動 git init）。資料夾不存在會自動建立。</p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input v-model="form.enabled" type="checkbox" class="h-4 w-4"> 啟用（PM 會依排程定時檢查）
          </label>
        </section>

        <section class="card space-y-4 p-5">
          <h2 class="font-semibold text-slate-800">PM agent</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label">PM 名字</label>
              <input v-model="form.pm_name" class="input" maxlength="40" placeholder="例如：PM-小明（留空會用「標題 PM」）">
              <p class="hint">agent 只有名字和 agent 標記，會出現在留言上。</p>
            </div>
            <div>
              <label class="label">檢查排程（cron）</label>
              <input v-model="form.cron" class="input mono" required>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <button v-for="p in presets" :key="p.value" type="button" class="rounded-full border px-2.5 py-0.5 text-xs"
                  :class="presetClass(p)" @click="form.cron = p.value">{{ p.label }}</button>
              </div>
              <p class="hint">時間到 PM 就檢查一次：派工、看 agent 進度、驗收和 commit。看板沒有進行中的票、也沒有 agent 在跑時會跳過。</p>
            </div>
          </div>
          <div>
            <label class="label">PM prompt</label>
            <textarea v-model="form.pm_prompt" class="input" rows="6" :placeholder="pmPromptPlaceholder"></textarea>
          </div>
          <div>
            <label class="label">PM 自己的 skills</label>
            <SkillPicker v-model="form.pm_skills" :skills="skills" />
          </div>
          <div>
            <label class="label">PM 可以下放的 skills</label>
            <SkillPicker v-model="form.allowed_skills" :skills="skills" />
            <p class="hint">PM 派 agent 時只能從這裡挑；PM 自己建立的 skill 會自動加進來。</p>
          </div>
        </section>

        <section class="card space-y-4 p-5">
          <h2 class="font-semibold text-slate-800">模型與限制</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label">PM 模型</label>
              <select v-model="form.pm_model" class="input">
                <option value="">{{ defaultModelLabel }}</option>
                <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}（{{ m.id }}）</option>
              </select>
            </div>
            <div>
              <label class="label">工作 agent 模型</label>
              <select v-model="form.worker_model" class="input">
                <option value="">{{ defaultModelLabel }}</option>
                <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}（{{ m.id }}）</option>
              </select>
            </div>
            <div>
              <label class="label">同時最多幾個工作 agent</label>
              <input v-model.number="form.max_workers" type="number" min="1" max="10" class="input">
              <p class="hint">建議 1：多個 agent 同時改同一個資料夾，PM commit 時變更會混在一起。</p>
            </div>
            <div>
              <label class="label">每次執行最多幾回合</label>
              <input v-model.number="form.max_turns" type="number" min="5" max="200" class="input">
              <p class="hint">避免 agent 一直跑；PM 檢查最多 30 回合。</p>
            </div>
          </div>
        </section>

        <div class="flex justify-end gap-2">
          <a :href="backLink" class="btn btn-secondary">取消</a>
          <button class="btn btn-primary" :disabled="saving">{{ saveLabel }}</button>
        </div>

        <section v-if="!isNew" class="card space-y-3 border-red-200 p-5">
          <h2 class="font-semibold text-red-700">刪除看板</h2>
          <p class="text-sm text-slate-600">會連同所有票、留言和執行紀錄一起刪除，無法復原。請輸入看板標題確認：</p>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input v-model="deleteText" class="input" :placeholder="form.title">
            <button type="button" class="btn btn-danger" :disabled="!canDelete" @click="remove">刪除看板</button>
          </div>
        </section>
      </form>
    </main>`
};

bootPage(BoardEditPage, { active: "boards" });
