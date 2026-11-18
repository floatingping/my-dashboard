import { api, debounce, fmtAgo, fmtDuration, fmtTime, onEvents, query } from "../common.js";
import { bootPage, notify } from "../components.js";

const TicketPage = {
  data() {
    return { ticketId: Number(query("id")), ticket: null, board: null, loading: true, notFound: false, sending: false };
  },
  computed: {
    boardLink() {
      return this.ticket ? `/board?id=${this.ticket.board_id}` : "/";
    },
    boardTitle() {
      return this.board?.title ?? "看板";
    },
    liveRuns() {
      return (this.ticket?.runs ?? []).filter((r) => r.status === "running");
    }
  },
  async mounted() {
    await this.load();
    this.reload = debounce(() => this.load(), 400);
    this.stopEvents = onEvents((event) => {
      if (event.ticketId === this.ticketId) this.reload();
    });
  },
  unmounted() {
    this.stopEvents?.();
  },
  methods: {
    async load() {
      try {
        this.ticket = await api(`/tickets/${this.ticketId}`);
        if (this.board?.id !== this.ticket.board_id) this.board = await api(`/boards/${this.ticket.board_id}`);
        document.title = `#${this.ticket.id} ${this.ticket.title} · Agent 看板`;
      } catch (err) {
        if (err.status === 404 || err.status === 400) this.notFound = true;
        else notify(err.message, "error");
      } finally {
        this.loading = false;
      }
    },
    async send(content, done) {
      this.sending = true;
      try {
        await api(`/tickets/${this.ticketId}/comments`, { method: "POST", body: { content } });
        done();
        await this.load();
        this.$nextTick(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
      } catch (err) {
        notify(err.message, "error");
      } finally {
        this.sending = false;
      }
    },
    async kill(run) {
      if (!confirm(`確定要關閉 ${run.agent_name}（run #${run.id}）嗎？`)) return;
      try {
        const res = await api(`/runs/${run.id}/kill`, { method: "POST" });
        notify(res.message, "success");
        await this.load();
      } catch (err) {
        notify(err.message, "error");
      }
    },
    isRunning(run) {
      return run.status === "running";
    },
    // PM 改狀態時自動留的紀錄
    isStatusNote(comment) {
      return comment.is_agent && comment.content.startsWith("🔄");
    },
    isReport(comment) {
      return comment.is_agent && comment.content.startsWith("📋");
    },
    avatarClass(comment) {
      return comment.is_agent ? "bg-violet-100 text-violet-700" : "bg-slate-900 text-white";
    },
    bubbleClass(comment) {
      return this.isReport(comment) ? "border-violet-200" : "border-slate-200";
    },
    initial(comment) {
      return comment.user_name.slice(0, 1).toUpperCase();
    },
    runLink(run) {
      return `/run?id=${run.id}`;
    },
    fmtTime,
    fmtAgo,
    fmtDuration
  },
  template: `
    <main class="mx-auto max-w-4xl px-4 py-6">
      <p v-if="loading" class="py-20 text-center text-slate-400">載入中…</p>
      <div v-else-if="notFound" class="card p-10 text-center text-slate-500">
        找不到這張票。<a href="/" class="text-blue-600 underline">回看板列表</a>
      </div>

      <template v-else-if="ticket">
        <a :href="boardLink" class="text-sm text-slate-500 hover:text-slate-800">← {{ boardTitle }}</a>

        <div class="card mt-2 p-5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="mono text-sm text-slate-400">#{{ ticket.id }}</span>
            <StatusBadge :status="ticket.status" />
            <span v-for="r in liveRuns" :key="r.id" class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"></span>{{ r.agent_name }} 工作中
            </span>
          </div>
          <h1 class="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{{ ticket.title }}</h1>
          <p class="mt-1 text-xs text-slate-500">
            {{ ticket.created_by_name }} 建立於 {{ fmtTime(ticket.created_at) }} · 更新於 {{ fmtAgo(ticket.updated_at) }}
          </p>
          <div v-if="ticket.result" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div class="mb-1 text-xs font-semibold text-emerald-700">result</div>
            <MdView :source="ticket.result" />
          </div>
        </div>

        <div v-if="ticket.runs.length" class="card mt-4 p-4">
          <h2 class="mb-1 text-sm font-semibold text-slate-700">Agent 執行紀錄</h2>
          <div v-for="r in ticket.runs" :key="r.id" class="flex flex-wrap items-center gap-2 border-t border-slate-100 py-2 text-sm first:border-t-0">
            <span class="mono text-xs text-slate-400">run #{{ r.id }}</span>
            <RunBadge :status="r.status" />
            <span class="text-slate-700">🤖 {{ r.agent_name }}</span>
            <span class="text-xs text-slate-400">{{ fmtTime(r.started_at) }} · {{ fmtDuration(r.started_at, r.ended_at) }}</span>
            <div class="ml-auto flex gap-2">
              <a :href="runLink(r)" class="btn btn-secondary btn-sm">看 log</a>
              <button v-if="isRunning(r)" class="btn btn-danger btn-sm" @click="kill(r)">關閉</button>
            </div>
          </div>
        </div>

        <h2 class="mb-3 mt-6 text-sm font-semibold text-slate-700">留言（{{ ticket.comments.length }}）</h2>
        <ol class="space-y-3">
          <li v-for="c in ticket.comments" :key="c.id">
            <div v-if="isStatusNote(c)" class="ml-11 rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-2 text-xs text-slate-600">
              <div class="mb-1 text-[11px] text-slate-400">{{ c.user_name }} · {{ fmtTime(c.created_at) }}</div>
              <MdView :source="c.content" />
            </div>
            <div v-else class="flex gap-3">
              <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold" :class="avatarClass(c)">{{ initial(c) }}</div>
              <div class="min-w-0 flex-1 rounded-xl border bg-white p-3 sm:p-4" :class="bubbleClass(c)">
                <div class="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <b class="text-slate-800">{{ c.user_name }}</b>
                  <span v-if="c.is_agent" class="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">agent</span>
                  <span class="text-slate-400">{{ fmtTime(c.created_at) }}</span>
                </div>
                <MdView :source="c.content" />
              </div>
            </div>
          </li>
        </ol>

        <div class="mt-6">
          <Composer placeholder="留言…（想改狀態，請在這裡跟 PM 說）" submit-label="留言" :busy="sending" @submit="send" />
          <p class="hint">票和留言只能新增；狀態和 result 只有 PM 能改。</p>
        </div>
      </template>
    </main>`
};

bootPage(TicketPage, { active: "boards" });
