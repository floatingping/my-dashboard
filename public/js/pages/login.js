import { createApp } from "vue";
import { api, query } from "../common.js";

const LoginPage = {
  data() {
    return { loaded: false, needsSetup: false, local: false, port: 3000, name: "", password: "", password2: "", busy: false, error: "" };
  },
  computed: {
    localUrl() {
      return `http://localhost:${this.port}`;
    },
    subtitle() {
      return this.needsSetup ? "建立第一個帳號" : "登入";
    },
    buttonLabel() {
      if (this.busy) return "處理中…";
      return this.needsSetup ? "建立並登入" : "登入";
    },
    passwordAutocomplete() {
      return this.needsSetup ? "new-password" : "current-password";
    }
  },
  async mounted() {
    const state = await api("/auth/state");
    if (state.user) {
      this.go();
      return;
    }
    this.needsSetup = state.needsSetup;
    this.local = state.local;
    this.port = state.port;
    this.loaded = true;
  },
  methods: {
    go() {
      const next = query("next") || "/";
      location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    },
    async submit() {
      this.error = "";
      if (this.needsSetup && this.password !== this.password2) {
        this.error = "兩次輸入的密碼不一樣";
        return;
      }
      this.busy = true;
      try {
        const path = this.needsSetup ? "/auth/setup" : "/auth/login";
        await api(path, { method: "POST", body: { name: this.name, password: this.password } });
        this.go();
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    }
  },
  template: `
    <div class="flex min-h-screen items-center justify-center px-4">
      <div v-if="loaded && needsSetup && !local" class="card w-full max-w-sm p-6 text-sm text-slate-600 shadow-sm">
        <h1 class="mb-2 text-lg font-bold text-slate-900">Agent 看板還沒有帳號</h1>
        <p>第一個帳號只能在伺服器那台電腦上建立：請在那台電腦開 <span class="mono">{{ localUrl }}</span>。</p>
      </div>
      <form v-else-if="loaded" class="card w-full max-w-sm p-6 shadow-sm" @submit.prevent="submit">
        <div class="mb-6 flex items-center gap-3">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 font-bold text-white">K</span>
          <div>
            <h1 class="text-lg font-bold text-slate-900">Agent 看板</h1>
            <p class="text-xs text-slate-500">{{ subtitle }}</p>
          </div>
        </div>
        <p v-if="needsSetup" class="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          第一次使用，請建立一個人類帳號（之後可以在「使用者」頁新增更多人）。
        </p>
        <label class="label">名字</label>
        <input v-model="name" class="input mb-4" autocomplete="username" required>
        <label class="label">密碼</label>
        <input v-model="password" type="password" class="input mb-4" :autocomplete="passwordAutocomplete" required>
        <template v-if="needsSetup">
          <label class="label">再輸入一次密碼</label>
          <input v-model="password2" type="password" class="input mb-4" autocomplete="new-password" required>
        </template>
        <p v-if="error" class="mb-3 text-sm text-red-600">{{ error }}</p>
        <button class="btn btn-primary w-full" :disabled="busy">{{ buttonLabel }}</button>
      </form>
    </div>`
};

createApp(LoginPage).mount("#app");
