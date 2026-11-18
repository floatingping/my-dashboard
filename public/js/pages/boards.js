import { api, debounce, fmtTime, onEvents, STATUSES } from "../common.js";
import { bootPage } from "../components.js";

const BoardsPage = {
  data() {
    return { boards: [], loaded: false, statuses: STATUSES };
  },
  async mounted() {
    await this.load();
    this.reload = debounce(() => this.load(), 800);
    this.stopEvents = onEvents((event) => {
      if (["board", "ticket", "run"].includes(event.type)) this.reload();
    });
  },
  unmounted() {
    this.stopEvents?.();
  },
  methods: {
    async load() {
      this.boards = await api("/boards");
      this.loaded = true;
    },
    boardLink(board) {
      return `/board?id=${board.id}`;
    },
    pmText(board) {
      if (!board.enabled) return "已停用";
      if (board.schedule.pm_running) return "PM 檢查中…";
      return board.schedule.next_check_at ? `下次檢查 ${fmtTime(board.schedule.next_check_at)}` : "未排程";
    },
    pmClass(board) {
      if (!board.enabled) return "text-slate-400";
      return board.schedule.pm_running ? "font-medium text-blue-600" : "text-slate-500";
    }
  },
  template: `
    <main class="mx-auto max-w-7xl px-4 py-6">
      <div class="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">看板</h1>
          <p class="text-sm text-slate-500">每個看板有一個 PM agent 定時檢查票，再派 agent 去完成</p>
        </div>
        <a href="/board-edit" class="btn btn-primary ml-auto">＋ 新增看板</a>
      </div>

      <div v-if="loaded && !boards.length" class="card p-10 text-center text-slate-500">
        還沒有看板，按右上角「新增看板」開始。
      </div>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <a v-for="board in boards" :key="board.id" :href="boardLink(board)"
          class="card block p-5 transition hover:-translate-y-0.5 hover:shadow-md">
          <div class="flex items-start gap-2">
            <h2 class="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900">{{ board.title }}</h2>
            <span v-if="!board.enabled" class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">停用</span>
          </div>
          <p class="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">{{ board.description }}</p>
          <div class="mt-3 space-y-1 text-xs">
            <p class="text-slate-600">🤖 PM：<b>{{ board.pm_name }}</b></p>
            <p :class="pmClass(board)">{{ pmText(board) }}</p>
            <p v-if="board.schedule.workers_running" class="text-blue-600">工作 agent 執行中：{{ board.schedule.workers_running }}</p>
          </div>
          <div class="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
            <span v-for="s in statuses" :key="s.key" class="inline-flex items-center gap-1 text-xs text-slate-600">
              <span class="h-2 w-2 rounded-full" :class="s.dot"></span>{{ s.key }} <b>{{ board.counts[s.key] }}</b>
            </span>
          </div>
          <p class="mono mt-2 truncate text-[11px] text-slate-400" :title="board.folder">📁 {{ board.folder }}</p>
        </a>
      </div>
    </main>`
};

bootPage(BoardsPage, { active: "boards" });
