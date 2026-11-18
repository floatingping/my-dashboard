import { api, debounce, fmtAgo, fmtDuration, fmtTime, onEvents, query, RUN_KIND, STATUSES, toDateInput } from "../common.js";
import { bootPage, notify } from "../components.js";

const VIEWS = [
  { key: "kanban", label: "看板" },
  { key: "list", label: "列表" },
  { key: "runs", label: "Agent 執行" }
];

const FIELD_OPTIONS = [
  { key: "updated", label: "更新時間" },
  { key: "created", label: "建立時間" }
];

function defaultFilters() {
  return {
    from: toDateInput(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: toDateInput(Date.now()),
    field: "updated",
    q: "",
    statuses: [],
    keepActive: true
  };
}

// 問 PM 的聊天面板（桌面在右側，手機全螢幕）
const PmChat = {
  props: { board: Object, version: Number },
  emits: ["close"],
  data() {
    return { messages: [], text: "", sending: false, loaded: false };
  },
  computed: {
    thinking() {
      return Boolean(this.board.schedule?.chat_running);
    }
  },
  watch: {
    version() {
      this.load();
    }
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.messages = await api(`/boards/${this.board.id}/chat`);
      this.loaded = true;
      this.$nextTick(() => {
        const el = this.$refs.list;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    rowClass(message) {
      return message.is_agent ? "justify-start" : "justify-end";
    },
    bubbleClass(message) {
      return message.is_agent ? "border border-slate-200 bg-white" : "bg-slate-900 text-white";
    },
    mdClass(message) {
      return message.is_agent ? "" : "md-invert";
    },
    onKey(event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.send();
      }
    },
    async send() {
      const content = this.text.trim();
      if (!content || this.sending) return;
      this.sending = true;
      try {
        await api(`/boards/${this.board.id}/chat`, { method: "POST", body: { content } });
        this.text = "";
        await this.load();
      } catch (err) {
        notify(err.message, "error");
      } finally {
        this.sending = false;
      }
    },
    close() {
      this.$emit("close");
    },
    fmtTime
  },
  template: `
    <aside class="fixed inset-0 z-40 flex flex-col bg-slate-50 shadow-2xl sm:left-auto sm:w-[420px] sm:border-l sm:border-slate-200">
      <div class="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div class="min-w-0">
          <h3 class="font-semibold text-slate-900">💬 問 PM</h3>
          <p class="text-xs text-slate-500">{{ board.pm_name }} 會查看板資料再回答，也可以請它開票、改狀態</p>
        </div>
        <button class="btn btn-ghost btn-sm ml-auto" aria-label="關閉" @click="close">✕</button>
      </div>
      <div ref="list" class="flex-1 space-y-3 overflow-y-auto p-4">
        <p v-if="loaded && !messages.length" class="py-10 text-center text-sm text-slate-400">
          還沒有對話，可以問「目前有哪些票卡住了？」
        </p>
        <div v-for="message in messages" :key="message.id" class="flex" :class="rowClass(message)">
          <div class="max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm" :class="bubbleClass(message)">
            <div class="mb-1 text-[11px] opacity-60">{{ message.user_name }} · {{ fmtTime(message.created_at) }}</div>
            <MdView :source="message.content" :class="mdClass(message)" />
          </div>
        </div>
        <div v-if="thinking" class="flex">
          <div class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
            <span class="animate-pulse">PM 思考中…</span>
          </div>
        </div>
      </div>
      <div class="border-t border-slate-200 bg-white p-3">
        <div class="flex items-end gap-2">
          <textarea v-model="text" rows="2" class="input flex-1" placeholder="輸入問題，Enter 送出，Shift+Enter 換行" @keydown="onKey"></textarea>
          <button class="btn btn-primary" :disabled="sending || !text.trim()" @click="send">送出</button>
        </div>
      </div>
    </aside>`
};

const BoardPage = {
  components: { PmChat },
  data() {
    return {
      boardId: Number(query("id")),
      board: null,
      tickets: [],
      runs: [],
      views: VIEWS,
      view: "kanban",
      statuses: STATUSES,
      fieldOptions: FIELD_OPTIONS,
      mobileStatus: "todo",
      filters: defaultFilters(),
      showNew: false,
      newTitle: "",
      creating: false,
      showChat: false,
      chatVersion: 0,
      loading: true,
      notFound: false
    };
  },
  computed: {
    isKanbanView() {
      return this.view === "kanban";
    },
    isListView() {
      return this.view === "list";
    },
    isRunsView() {
      return this.view === "runs";
    },
    grouped() {
      const map = Object.fromEntries(STATUSES.map((s) => [s.key, []]));
      for (const ticket of this.tickets) map[ticket.status]?.push(ticket);
      return map;
    },
    listTickets() {
      const picked = this.filters.statuses;
      return picked.length ? this.tickets.filter((t) => picked.includes(t.status)) : this.tickets;
    },
    liveByTicket() {
      const map = {};
      for (const run of this.runs) {
        if (run.live && run.ticket_id) map[run.ticket_id] = run;
      }
      return map;
    },
    pmStatus() {
      const schedule = this.board?.schedule;
      if (!schedule) return "";
      if (!this.board.enabled) return "已停用（不會定時檢查）";
      if (schedule.pm_running) return "PM 檢查中…";
      return schedule.next_check_at ? `下次檢查 ${fmtTime(schedule.next_check_at)}` : "未排程";
    },
    pmStatusClass() {
      return this.board?.schedule?.pm_running ? "font-medium text-blue-600" : "";
    },
    settingsLink() {
      return `/board-edit?id=${this.boardId}`;
    }
  },
  watch: {
    filters: {
      deep: true,
      handler() {
        this.reloadTickets?.();
      }
    }
  },
  async mounted() {
    if (!this.boardId) {
      this.notFound = true;
      this.loading = false;
      return;
    }
    await this.loadAll();
    this.reloadTickets = debounce(() => this.loadTickets().catch((err) => notify(err.message, "error")), 400);
    this.reloadMeta = debounce(() => {
      this.loadBoard().catch(() => {});
      this.loadRuns().catch(() => {});
    }, 600);
    this.stopEvents = onEvents((event) => this.onEvent(event));
    // 讓「下次檢查」時間保持新的
    this.timer = setInterval(() => this.loadBoard().catch(() => {}), 30000);
  },
  unmounted() {
    this.stopEvents?.();
    clearInterval(this.timer);
  },
  methods: {
    async loadAll() {
      try {
        await Promise.all([this.loadBoard(), this.loadTickets(), this.loadRuns()]);
      } catch (err) {
        if (err.status === 404 || err.status === 400) this.notFound = true;
        else notify(err.message, "error");
      } finally {
        this.loading = false;
      }
    },
    async loadBoard() {
      this.board = await api(`/boards/${this.boardId}`);
      document.title = `${this.board.title} · Agent 看板`;
    },
    async loadTickets() {
      const f = this.filters;
      const params = new URLSearchParams({ field: f.field, keep_active: f.keepActive ? "1" : "0", limit: "500" });
      if (f.from) params.set("from", new Date(`${f.from}T00:00:00`).toISOString());
      if (f.to) params.set("to", new Date(`${f.to}T23:59:59.999`).toISOString());
      if (f.q.trim()) params.set("q", f.q.trim());
      this.tickets = await api(`/boards/${this.boardId}/tickets?${params}`);
    },
    async loadRuns() {
      this.runs = await api(`/boards/${this.boardId}/runs?limit=50`);
    },
    onEvent(event) {
      if (event.boardId !== this.boardId) return;
      if (event.type === "ticket" || event.type === "comment") this.reloadTickets();
      if (event.type === "run" || event.type === "board" || event.type === "ticket") this.reloadMeta();
      if (event.type === "chat") {
        this.chatVersion += 1;
        this.reloadMeta();
      }
    },
    resetFilters() {
      this.filters = defaultFilters();
    },
    viewClass(view) {
      return view.key === this.view ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800";
    },
    mobileTabClass(status) {
      return status.key === this.mobileStatus ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600";
    },
    columnClass(status) {
      return status.key === this.mobileStatus ? "flex" : "hidden md:flex";
    },
    statusChipClass(status) {
      return this.filters.statuses.includes(status.key)
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-300 bg-white text-slate-600 hover:border-slate-500";
    },
    toggleStatus(status) {
      const list = this.filters.statuses;
      const index = list.indexOf(status.key);
      if (index >= 0) list.splice(index, 1);
      else list.push(status.key);
    },
    ticketLink(ticket) {
      return `/ticket?id=${ticket.id}`;
    },
    ticketIdLink(id) {
      return `/ticket?id=${id}`;
    },
    openTicket(ticket) {
      location.href = this.ticketLink(ticket);
    },
    runLink(run) {
      return `/run?id=${run.id}`;
    },
    kindLabel(run) {
      return RUN_KIND[run.kind] ?? run.kind;
    },
    async runPm() {
      try {
        const res = await api(`/boards/${this.boardId}/run-pm`, { method: "POST" });
        notify(res.started ? "PM 開始檢查了" : res.reason, res.started ? "success" : "info");
        this.reloadMeta();
      } catch (err) {
        notify(err.message, "error");
      }
    },
    async createTicket(content, done) {
      this.creating = true;
      try {
        const ticket = await api(`/boards/${this.boardId}/tickets`, {
          method: "POST",
          body: { title: this.newTitle, content }
        });
        done();
        this.newTitle = "";
        this.showNew = false;
        notify(`已開票 #${ticket.id}，PM 會在下次排程檢查時處理`, "success");
        await this.loadTickets();
      } catch (err) {
        notify(err.message, "error");
      } finally {
        this.creating = false;
      }
    },
    async kill(run) {
      if (!confirm(`確定要關閉 run #${run.id}（${run.agent_name}）嗎？`)) return;
      try {
        const res = await api(`/runs/${run.id}/kill`, { method: "POST" });
        notify(res.message, "success");
        this.reloadMeta();
      } catch (err) {
        notify(err.message, "error");
      }
    },
    fmtTime,
    fmtAgo,
    fmtDuration
  },
  template: `
    <main class="mx-auto max-w-7xl px-4 py-6">
      <p v-if="loading" class="py-20 text-center text-slate-400">載入中…</p>
      <div v-else-if="notFound" class="card p-10 text-center text-slate-500">
        找不到這個看板。<a href="/" class="text-blue-600 underline">回看板列表</a>
      </div>

      <template v-else-if="board">
        <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← 看板列表</a>
            <h1 class="mt-1 text-2xl font-bold text-slate-900">{{ board.title }}</h1>
            <p v-if="board.description" class="mt-1 whitespace-pre-line text-sm text-slate-600">{{ board.description }}</p>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>🤖 PM：<b class="text-slate-700">{{ board.pm_name }}</b></span>
              <span :class="pmStatusClass">{{ pmStatus }}</span>
              <span>工作 agent {{ board.schedule.workers_running }} / {{ board.max_workers }}</span>
              <span class="mono max-w-full truncate" :title="board.folder">📁 {{ board.folder }}</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-primary" @click="showNew = true">＋ 開新票</button>
            <button class="btn btn-secondary" @click="showChat = true">💬 問 PM</button>
            <button class="btn btn-secondary" @click="runPm">⚡ 立即檢查</button>
            <a class="btn btn-ghost" :href="settingsLink">⚙ 設定</a>
          </div>
        </div>

        <div class="card mb-4 p-3">
          <div class="flex flex-wrap items-center gap-3">
            <div class="inline-flex rounded-lg bg-slate-100 p-1">
              <button v-for="v in views" :key="v.key" class="rounded-md px-3 py-1.5 text-sm font-medium"
                :class="viewClass(v)" @click="view = v.key">{{ v.label }}</button>
            </div>
            <template v-if="!isRunsView">
              <div class="flex flex-wrap items-center gap-2">
                <select v-model="filters.field" class="input w-auto py-1.5">
                  <option v-for="o in fieldOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
                </select>
                <input v-model="filters.from" type="date" class="input w-auto py-1.5">
                <span class="text-slate-400">～</span>
                <input v-model="filters.to" type="date" class="input w-auto py-1.5">
              </div>
              <input v-model="filters.q" class="input w-full py-1.5 sm:w-60" placeholder="搜尋標題、result 或 #編號">
              <label class="flex items-center gap-1.5 text-sm text-slate-600">
                <input v-model="filters.keepActive" type="checkbox" class="h-4 w-4">進行中的票不受時間限制
              </label>
              <button class="btn btn-ghost btn-sm" @click="resetFilters">重設</button>
            </template>
          </div>
          <div v-if="isListView" class="mt-3 flex flex-wrap gap-2">
            <button v-for="s in statuses" :key="s.key" class="rounded-full border px-3 py-1 text-xs"
              :class="statusChipClass(s)" @click="toggleStatus(s)">{{ s.key }} · {{ s.label }}</button>
          </div>
        </div>

        <div v-if="isKanbanView">
          <div class="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
            <button v-for="s in statuses" :key="s.key" class="shrink-0 rounded-full px-3 py-1.5 text-sm"
              :class="mobileTabClass(s)" @click="mobileStatus = s.key">
              {{ s.key }} <span class="opacity-70">{{ grouped[s.key].length }}</span>
            </button>
          </div>
          <div class="grid gap-3 md:grid-cols-5">
            <section v-for="s in statuses" :key="s.key" class="flex-col rounded-xl bg-slate-200/60 p-2" :class="columnClass(s)">
              <header class="flex items-center gap-2 px-2 py-1.5">
                <span class="h-2 w-2 rounded-full" :class="s.dot"></span>
                <span class="text-sm font-semibold text-slate-700">{{ s.key }}</span>
                <span class="text-xs text-slate-500">{{ s.label }}</span>
                <span class="ml-auto rounded-full bg-white px-2 text-xs text-slate-600">{{ grouped[s.key].length }}</span>
              </header>
              <div class="flex flex-col gap-2">
                <a v-for="t in grouped[s.key]" :key="t.id" :href="ticketLink(t)"
                  class="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-400 hover:shadow">
                  <div class="flex items-center gap-2">
                    <span class="mono text-xs text-slate-400">#{{ t.id }}</span>
                    <span v-if="liveByTicket[t.id]" class="ml-auto inline-flex items-center gap-1 text-[11px] text-blue-600">
                      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"></span>{{ liveByTicket[t.id].agent_name }}
                    </span>
                  </div>
                  <p class="mt-1 line-clamp-2 text-sm font-medium text-slate-800">{{ t.title }}</p>
                  <p v-if="t.result" class="mt-1 line-clamp-2 text-xs text-slate-500">{{ t.result }}</p>
                  <p class="mt-2 text-[11px] text-slate-400">{{ t.created_by_name }} · {{ fmtAgo(t.updated_at) }}</p>
                </a>
                <p v-if="!grouped[s.key].length" class="px-2 py-4 text-center text-xs text-slate-400">沒有票</p>
              </div>
            </section>
          </div>
        </div>

        <div v-if="isListView" class="card overflow-hidden">
          <table class="hidden w-full text-sm md:table">
            <thead class="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th class="px-4 py-2">#</th>
                <th class="px-4 py-2">標題</th>
                <th class="px-4 py-2">狀態</th>
                <th class="px-4 py-2">result</th>
                <th class="px-4 py-2">建立者</th>
                <th class="px-4 py-2">建立</th>
                <th class="px-4 py-2">更新</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in listTickets" :key="t.id" class="cursor-pointer border-t border-slate-100 hover:bg-slate-50" @click="openTicket(t)">
                <td class="mono px-4 py-2 text-slate-400">{{ t.id }}</td>
                <td class="px-4 py-2 font-medium text-slate-800">{{ t.title }}</td>
                <td class="px-4 py-2"><StatusBadge :status="t.status" /></td>
                <td class="max-w-xs truncate px-4 py-2 text-slate-500" :title="t.result">{{ t.result }}</td>
                <td class="px-4 py-2 text-slate-600">{{ t.created_by_name }}</td>
                <td class="whitespace-nowrap px-4 py-2 text-slate-500">{{ fmtTime(t.created_at) }}</td>
                <td class="whitespace-nowrap px-4 py-2 text-slate-500">{{ fmtTime(t.updated_at) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="divide-y divide-slate-100 md:hidden">
            <a v-for="t in listTickets" :key="t.id" :href="ticketLink(t)" class="block p-3">
              <div class="flex items-center gap-2">
                <span class="mono text-xs text-slate-400">#{{ t.id }}</span>
                <StatusBadge :status="t.status" />
                <span class="ml-auto text-xs text-slate-400">{{ fmtTime(t.updated_at) }}</span>
              </div>
              <p class="mt-1 text-sm font-medium text-slate-800">{{ t.title }}</p>
              <p v-if="t.result" class="mt-0.5 line-clamp-2 text-xs text-slate-500">{{ t.result }}</p>
            </a>
          </div>
          <p v-if="!listTickets.length" class="p-8 text-center text-sm text-slate-400">沒有符合條件的票</p>
        </div>

        <div v-if="isRunsView" class="card overflow-hidden">
          <div v-for="r in runs" :key="r.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-3 first:border-t-0">
            <span class="mono text-xs text-slate-400">run #{{ r.id }}</span>
            <RunBadge :status="r.status" />
            <span class="text-sm font-medium text-slate-800">{{ kindLabel(r) }}</span>
            <span class="text-sm text-slate-600">🤖 {{ r.agent_name }}</span>
            <a v-if="r.ticket_id" :href="ticketIdLink(r.ticket_id)" class="text-sm text-blue-600 hover:underline">票 #{{ r.ticket_id }}</a>
            <span class="text-xs text-slate-400">{{ fmtTime(r.started_at) }} · {{ fmtDuration(r.started_at, r.ended_at) }}</span>
            <div class="ml-auto flex gap-2">
              <a :href="runLink(r)" class="btn btn-secondary btn-sm">看 log</a>
              <button v-if="r.live" class="btn btn-danger btn-sm" @click="kill(r)">關閉</button>
            </div>
          </div>
          <p v-if="!runs.length" class="p-8 text-center text-sm text-slate-400">還沒有執行紀錄</p>
        </div>
      </template>

      <Modal v-if="showNew" title="開新票" wide @close="showNew = false">
        <label class="label">標題（可以留空，會用內容的第一行）</label>
        <input v-model="newTitle" class="input mb-4" placeholder="例如：設計登入流程">
        <label class="label">內容（就是這張票的第一則留言）</label>
        <Composer :rows="8" placeholder="描述要做什麼、驗收標準…可以貼圖或附檔" submit-label="開票" :busy="creating" @submit="createTicket" />
      </Modal>

      <PmChat v-if="showChat && board" :board="board" :version="chatVersion" @close="showChat = false" />
    </main>`
};

bootPage(BoardPage, { active: "boards" });
