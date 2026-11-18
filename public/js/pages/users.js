import { api, fmtTime } from "../common.js";
import { bootPage, notify } from "../components.js";

const TYPES = [
  { value: false, label: "👤 人" },
  { value: true, label: "🤖 agent" }
];

function blankForm() {
  return { name: "", is_agent: false, password: "" };
}

const UsersPage = {
  props: { user: Object },
  data() {
    return { users: [], form: blankForm(), types: TYPES, creating: false, editing: null, editForm: { name: "", password: "" } };
  },
  computed: {
    editTitle() {
      return this.editing ? `編輯 ${this.editing.name}` : "";
    },
    humans() {
      return this.users.filter((u) => !u.is_agent);
    },
    agents() {
      return this.users.filter((u) => u.is_agent);
    },
    groups() {
      return [
        { key: "humans", title: "人", hint: "可以登入，用名字和密碼", users: this.humans },
        { key: "agents", title: "agent", hint: "只有名字和 agent 標記，不能登入；PM 派工時會自動建立", users: this.agents }
      ];
    }
  },
  async mounted() {
    await this.load();
  },
  methods: {
    async load() {
      this.users = await api("/users");
    },
    typeClass(type) {
      return this.form.is_agent === type.value ? "bg-slate-900 text-white" : "bg-white text-slate-600";
    },
    isSelf(user) {
      return user.id === this.user.id;
    },
    async create() {
      this.creating = true;
      try {
        const body = { name: this.form.name, is_agent: this.form.is_agent };
        if (!this.form.is_agent) body.password = this.form.password;
        await api("/users", { method: "POST", body });
        notify("已新增", "success");
        this.form = blankForm();
        await this.load();
      } catch (err) {
        notify(err.message, "error");
      } finally {
        this.creating = false;
      }
    },
    startEdit(user) {
      this.editing = user;
      this.editForm = { name: user.name, password: "" };
    },
    async saveEdit() {
      try {
        const body = { name: this.editForm.name };
        if (this.editForm.password) body.password = this.editForm.password;
        await api(`/users/${this.editing.id}`, { method: "PATCH", body });
        notify("已儲存", "success");
        this.editing = null;
        await this.load();
      } catch (err) {
        notify(err.message, "error");
      }
    },
    async remove(user) {
      if (!confirm(`確定要刪除「${user.name}」嗎？舊留言上的名字會保留。`)) return;
      try {
        await api(`/users/${user.id}`, { method: "DELETE" });
        notify("已刪除", "success");
        await this.load();
      } catch (err) {
        notify(err.message, "error");
      }
    },
    fmtTime
  },
  template: `
    <main class="mx-auto max-w-5xl px-4 py-6">
      <h1 class="text-2xl font-bold text-slate-900">使用者</h1>
      <p class="text-sm text-slate-500">人可以登入；agent 只有名字和 agent 標記</p>

      <form class="card mt-4 grid gap-3 p-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end" @submit.prevent="create">
        <div>
          <label class="label">類型</label>
          <div class="inline-flex overflow-hidden rounded-lg border border-slate-300">
            <button v-for="t in types" :key="t.label" type="button" class="px-3 py-2 text-sm" :class="typeClass(t)" @click="form.is_agent = t.value">{{ t.label }}</button>
          </div>
        </div>
        <div>
          <label class="label">名字</label>
          <input v-model="form.name" class="input" required maxlength="40">
        </div>
        <div>
          <template v-if="!form.is_agent">
            <label class="label">密碼（至少 6 個字元）</label>
            <input v-model="form.password" type="password" class="input" required minlength="6" autocomplete="new-password">
          </template>
        </div>
        <button class="btn btn-primary" :disabled="creating">＋ 新增</button>
      </form>

      <section v-for="g in groups" :key="g.key" class="mt-6">
        <h2 class="font-semibold text-slate-800">{{ g.title }} <span class="text-sm font-normal text-slate-400">{{ g.users.length }}</span></h2>
        <p class="mb-2 text-xs text-slate-500">{{ g.hint }}</p>
        <div class="card divide-y divide-slate-100">
          <div v-for="u in g.users" :key="u.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <span class="font-medium text-slate-800">{{ u.name }}</span>
            <span v-if="isSelf(u)" class="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">你</span>
            <span class="text-xs text-slate-400">建立於 {{ fmtTime(u.created_at) }}</span>
            <div class="ml-auto flex gap-2">
              <button class="btn btn-secondary btn-sm" @click="startEdit(u)">編輯</button>
              <button v-if="!isSelf(u)" class="btn btn-ghost btn-sm text-red-600" @click="remove(u)">刪除</button>
            </div>
          </div>
          <p v-if="!g.users.length" class="px-4 py-6 text-center text-sm text-slate-400">沒有</p>
        </div>
      </section>

      <Modal v-if="editing" :title="editTitle" @close="editing = null">
        <form class="space-y-4" @submit.prevent="saveEdit">
          <div>
            <label class="label">名字</label>
            <input v-model="editForm.name" class="input" required maxlength="40">
          </div>
          <div v-if="!editing.is_agent">
            <label class="label">新密碼（不改就留空）</label>
            <input v-model="editForm.password" type="password" class="input" minlength="6" autocomplete="new-password">
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn btn-secondary" @click="editing = null">取消</button>
            <button class="btn btn-primary">儲存</button>
          </div>
        </form>
      </Modal>
    </main>`
};

bootPage(UsersPage, { active: "users" });
